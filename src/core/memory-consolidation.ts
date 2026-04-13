/**
 * Memory Consolidation Engine
 *
 * Periodic background process that maintains memory health:
 * - Deduplication: merges near-duplicate files (Jaccard > 0.6)
 * - Contradiction detection: flags conflicting numeric facts
 * - Temporal validity: marks stale files (no update in 30 days)
 * - Importance decay: high → normal → low over time (critical never decays)
 *
 * Inspired by Letta's "sleep-time compute" and Zep's temporal invalidation.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parseFrontmatter, type Importance } from '../agents/persona.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConsolidationResult {
  role: string;
  scanned: number;
  duplicatesMerged: number;
  contradictionsFlagged: number;
  staleMarked: number;
  importanceDecayed: number;
}

export interface MemoryHealthReport {
  agents: Record<string, {
    total: number;
    stale: number;
    conflicts: number;
    duplicates: number;
  }>;
  lastConsolidation: string | null;
}

interface MemoryEntry {
  filepath: string;
  filename: string;
  raw: string;
  frontmatter: Record<string, string>;
  body: string;
  mtime: number;
}

// ---------------------------------------------------------------------------
// Frontmatter helpers
// ---------------------------------------------------------------------------

/**
 * Parse frontmatter into a key-value map (string values only — lightweight).
 * Returns the full raw frontmatter block and the body separately.
 */
function parseFrontmatterRaw(raw: string): { fm: Record<string, string>; body: string; fmBlock: string } {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { fm: {}, body: raw, fmBlock: '' };
  const fmBlock = match[1];
  const body = match[2];
  const fm: Record<string, string> = {};
  for (const line of fmBlock.split('\n')) {
    const m = line.match(/^(\w[\w_-]*):\s*(.*)$/);
    if (m) fm[m[1]] = m[2].trim();
  }
  return { fm, body, fmBlock };
}

/**
 * Set or update a frontmatter field in a raw markdown string.
 * Creates frontmatter block if none exists.
 */
export function setFrontmatterField(raw: string, key: string, value: string): string {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    // No frontmatter — create one
    return `---\n${key}: ${value}\n---\n${raw}`;
  }

  const fmBlock = match[1];
  const body = match[2];
  const lines = fmBlock.split('\n');

  // Check if key already exists
  const idx = lines.findIndex(l => l.match(new RegExp(`^${key}:\\s`)));
  if (idx >= 0) {
    lines[idx] = `${key}: ${value}`;
  } else {
    lines.push(`${key}: ${value}`);
  }

  return `---\n${lines.join('\n')}\n---\n${body}`;
}

// ---------------------------------------------------------------------------
// Tokenization + Similarity
// ---------------------------------------------------------------------------

/** Simple word tokenizer — lowercase, alphanumeric tokens only */
function tokenize(text: string): Set<string> {
  const tokens = text.toLowerCase().match(/[a-z0-9]+/g);
  return new Set(tokens ?? []);
}

/** Jaccard similarity between two token sets */
function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// ---------------------------------------------------------------------------
// Contradiction detection
// ---------------------------------------------------------------------------

/** Extract numeric facts: "free tier is 50 users" → { context: "free tier users", value: 50 } */
interface NumericFact {
  context: string;     // surrounding words for matching
  value: number;
  raw: string;         // original sentence
}

function extractNumericFacts(text: string): NumericFact[] {
  const facts: NumericFact[] = [];
  // Match sentences containing numbers
  const sentences = text.split(/[.!?\n]+/).filter(s => s.trim());
  for (const sentence of sentences) {
    const matches = sentence.match(/\d+(?:\.\d+)?/g);
    if (!matches) continue;
    for (const numStr of matches) {
      const value = parseFloat(numStr);
      if (isNaN(value)) continue;
      // Context = words around the number (remove the number itself)
      const context = sentence
        .replace(numStr, '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .trim()
        .split(/\s+/)
        .filter(w => w.length > 2)
        .join(' ');
      if (context.length > 5) {
        facts.push({ context, value, raw: sentence.trim() });
      }
    }
  }
  return facts;
}

/** Check if two numeric facts likely refer to the same thing but disagree */
function factsContradict(a: NumericFact, b: NumericFact): boolean {
  if (a.value === b.value) return false; // same number = no contradiction
  const tokensA = tokenize(a.context);
  const tokensB = tokenize(b.context);
  const sim = jaccardSimilarity(tokensA, tokensB);
  return sim > 0.5; // similar context + different number = contradiction
}

// ---------------------------------------------------------------------------
// Scanning
// ---------------------------------------------------------------------------

function scanDirectory(dirPath: string): MemoryEntry[] {
  if (!existsSync(dirPath)) return [];
  const entries: MemoryEntry[] = [];

  function walk(dir: string): void {
    let items: string[];
    try { items = readdirSync(dir); } catch { return; }
    for (const item of items) {
      const full = join(dir, item);
      try {
        const stat = statSync(full);
        if (stat.isDirectory()) {
          walk(full);
        } else if (item.endsWith('.md')) {
          const raw = readFileSync(full, 'utf-8');
          const { fm, body } = parseFrontmatterRaw(raw);
          entries.push({
            filepath: full,
            filename: item,
            raw,
            frontmatter: fm,
            body,
            mtime: stat.mtimeMs,
          });
        }
      } catch { /* skip unreadable */ }
    }
  }

  walk(dirPath);
  return entries;
}

// ---------------------------------------------------------------------------
// Core consolidation passes
// ---------------------------------------------------------------------------

const STALE_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const SIMILARITY_THRESHOLD = 0.6;

/** Decay importance: high → normal → low. Critical never decays. */
const DECAY_MAP: Record<string, Importance> = {
  high: 'normal',
  normal: 'low',
};

// Importance decay threshold: 14 days without update
const DECAY_THRESHOLD_MS = 14 * 24 * 60 * 60 * 1000;

export interface ConsolidationOptions {
  dryRun?: boolean;
  staleThresholdMs?: number;
  similarityThreshold?: number;
  decayThresholdMs?: number;
}

/**
 * Run consolidation for a single agent role's memory directory.
 */
export function consolidateRole(
  memoryDir: string,
  role: string,
  opts: ConsolidationOptions = {},
): ConsolidationResult {
  const dryRun = opts.dryRun ?? false;
  const staleThreshold = opts.staleThresholdMs ?? STALE_THRESHOLD_MS;
  const simThreshold = opts.similarityThreshold ?? SIMILARITY_THRESHOLD;
  const decayThreshold = opts.decayThresholdMs ?? DECAY_THRESHOLD_MS;

  const entries = scanDirectory(memoryDir);
  const now = Date.now();

  const result: ConsolidationResult = {
    role,
    scanned: entries.length,
    duplicatesMerged: 0,
    contradictionsFlagged: 0,
    staleMarked: 0,
    importanceDecayed: 0,
  };

  if (entries.length === 0) return result;

  // Track which files have been superseded (skip them in later passes)
  const superseded = new Set<string>();

  // --- Pass 1: Deduplication ---
  const tokenSets = entries.map(e => tokenize(e.body));
  for (let i = 0; i < entries.length; i++) {
    if (superseded.has(entries[i].filepath)) continue;
    if (entries[i].frontmatter.superseded_by) {
      superseded.add(entries[i].filepath);
      continue;
    }

    for (let j = i + 1; j < entries.length; j++) {
      if (superseded.has(entries[j].filepath)) continue;
      if (entries[j].frontmatter.superseded_by) {
        superseded.add(entries[j].filepath);
        continue;
      }

      const sim = jaccardSimilarity(tokenSets[i], tokenSets[j]);
      if (sim >= simThreshold) {
        // Keep the more recently modified file; supersede the older one
        const [keeper, loser] = entries[i].mtime >= entries[j].mtime
          ? [entries[i], entries[j]]
          : [entries[j], entries[i]];

        if (!dryRun) {
          const updated = setFrontmatterField(loser.raw, 'superseded_by', keeper.filename);
          writeFileSync(loser.filepath, updated, 'utf-8');
        }

        superseded.add(loser.filepath);
        result.duplicatesMerged++;
      }
    }
  }

  // --- Pass 2: Contradiction detection ---
  const factsPerEntry = entries.map(e => ({
    entry: e,
    facts: extractNumericFacts(e.body),
  }));

  for (let i = 0; i < factsPerEntry.length; i++) {
    if (superseded.has(factsPerEntry[i].entry.filepath)) continue;
    if (factsPerEntry[i].entry.frontmatter.conflicts_with) continue; // already flagged

    for (let j = i + 1; j < factsPerEntry.length; j++) {
      if (superseded.has(factsPerEntry[j].entry.filepath)) continue;

      let found = false;
      for (const factA of factsPerEntry[i].facts) {
        for (const factB of factsPerEntry[j].facts) {
          if (factsContradict(factA, factB)) {
            found = true;
            if (!dryRun) {
              const updatedI = setFrontmatterField(
                readFileSync(factsPerEntry[i].entry.filepath, 'utf-8'),
                'conflicts_with',
                factsPerEntry[j].entry.filename,
              );
              const updatedI2 = setFrontmatterField(updatedI, 'confidence', 'low');
              writeFileSync(factsPerEntry[i].entry.filepath, updatedI2, 'utf-8');

              const updatedJ = setFrontmatterField(
                readFileSync(factsPerEntry[j].entry.filepath, 'utf-8'),
                'conflicts_with',
                factsPerEntry[i].entry.filename,
              );
              const updatedJ2 = setFrontmatterField(updatedJ, 'confidence', 'low');
              writeFileSync(factsPerEntry[j].entry.filepath, updatedJ2, 'utf-8');
            }
            result.contradictionsFlagged++;
            break;
          }
        }
        if (found) break;
      }
    }
  }

  // --- Pass 3: Temporal validity (staleness) ---
  for (const entry of entries) {
    if (superseded.has(entry.filepath)) continue;
    if (entry.frontmatter.stale === 'true') continue; // already stale
    // Never mark critical files as stale
    if (entry.frontmatter.importance === 'critical') continue;
    // Strategic layer files don't go stale
    if (entry.frontmatter.layer === 'strategic') continue;

    const age = now - entry.mtime;
    if (age >= staleThreshold) {
      if (!dryRun) {
        const updated = setFrontmatterField(
          readFileSync(entry.filepath, 'utf-8'),
          'stale',
          'true',
        );
        writeFileSync(entry.filepath, updated, 'utf-8');
      }
      result.staleMarked++;
    }
  }

  // --- Pass 4: Importance decay ---
  for (const entry of entries) {
    if (superseded.has(entry.filepath)) continue;
    const importance = entry.frontmatter.importance;
    if (!importance || importance === 'critical' || importance === 'low') continue;

    const age = now - entry.mtime;
    if (age >= decayThreshold) {
      const decayed = DECAY_MAP[importance];
      if (decayed) {
        if (!dryRun) {
          const updated = setFrontmatterField(
            readFileSync(entry.filepath, 'utf-8'),
            'importance',
            decayed,
          );
          writeFileSync(entry.filepath, updated, 'utf-8');
        }
        result.importanceDecayed++;
      }
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Multi-role consolidation
// ---------------------------------------------------------------------------

/**
 * Run consolidation across all agents (or a single role).
 */
export function consolidateAll(
  stateDir: string,
  opts: ConsolidationOptions & { role?: string } = {},
): ConsolidationResult[] {
  const agentsDir = join(stateDir, 'agents');
  if (!existsSync(agentsDir)) return [];

  let roles: string[];
  if (opts.role) {
    roles = [opts.role];
  } else {
    try {
      roles = readdirSync(agentsDir).filter(name => {
        if (!/^[a-z0-9_-]+$/.test(name)) return false;
        const memDir = join(agentsDir, name, 'memory');
        try { return statSync(memDir).isDirectory(); } catch { return false; }
      });
    } catch {
      return [];
    }
  }

  const results: ConsolidationResult[] = [];
  for (const role of roles) {
    const memDir = join(agentsDir, role, 'memory');
    results.push(consolidateRole(memDir, role, opts));
  }

  // Record last consolidation timestamp
  if (!opts.dryRun) {
    try {
      const metaPath = join(stateDir, '.consolidation-meta.json');
      const meta = { lastConsolidation: new Date().toISOString() };
      writeFileSync(metaPath, JSON.stringify(meta), 'utf-8');
    } catch { /* best effort */ }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Health report
// ---------------------------------------------------------------------------

/**
 * Build a memory health report for the dashboard.
 */
export function getMemoryHealth(stateDir: string): MemoryHealthReport {
  const agentsDir = join(stateDir, 'agents');
  const report: MemoryHealthReport = {
    agents: {},
    lastConsolidation: null,
  };

  // Read last consolidation timestamp
  try {
    const metaPath = join(stateDir, '.consolidation-meta.json');
    if (existsSync(metaPath)) {
      const meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
      report.lastConsolidation = meta.lastConsolidation ?? null;
    }
  } catch { /* no meta */ }

  if (!existsSync(agentsDir)) return report;

  let roles: string[];
  try {
    roles = readdirSync(agentsDir).filter(name => {
      if (!/^[a-z0-9_-]+$/.test(name)) return false;
      const memDir = join(agentsDir, name, 'memory');
      try { return statSync(memDir).isDirectory(); } catch { return false; }
    });
  } catch {
    return report;
  }

  for (const role of roles) {
    const memDir = join(agentsDir, role, 'memory');
    const entries = scanDirectory(memDir);

    let stale = 0;
    let conflicts = 0;
    let duplicates = 0;

    for (const entry of entries) {
      if (entry.frontmatter.stale === 'true') stale++;
      if (entry.frontmatter.conflicts_with) conflicts++;
      if (entry.frontmatter.superseded_by) duplicates++;
    }

    report.agents[role] = {
      total: entries.length,
      stale,
      conflicts,
      duplicates,
    };
  }

  return report;
}

// ---------------------------------------------------------------------------
// Exported utilities for testing
// ---------------------------------------------------------------------------

export { tokenize, jaccardSimilarity, extractNumericFacts, factsContradict, parseFrontmatterRaw };
