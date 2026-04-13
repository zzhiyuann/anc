import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  consolidateRole,
  consolidateAll,
  getMemoryHealth,
  setFrontmatterField,
  tokenize,
  jaccardSimilarity,
  extractNumericFacts,
  factsContradict,
  parseFrontmatterRaw,
} from '../src/core/memory-consolidation.js';

const TEST_DIR = join(tmpdir(), 'anc-consolidation-test-' + process.pid);

function setupDir(...parts: string[]): string {
  const dir = join(TEST_DIR, ...parts);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeFile(dir: string, name: string, content: string): void {
  writeFileSync(join(dir, name), content, 'utf-8');
}

function readFile(dir: string, name: string): string {
  return readFileSync(join(dir, name), 'utf-8');
}

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  try { rmSync(TEST_DIR, { recursive: true, force: true }); } catch { /* */ }
});

// ---------------------------------------------------------------------------
// Unit tests: utilities
// ---------------------------------------------------------------------------

describe('tokenize', () => {
  it('extracts lowercase alphanumeric tokens', () => {
    const tokens = tokenize('Hello World! This is a TEST 123.');
    expect(tokens).toContain('hello');
    expect(tokens).toContain('world');
    expect(tokens).toContain('test');
    expect(tokens).toContain('123');
  });
});

describe('jaccardSimilarity', () => {
  it('returns 1 for identical sets', () => {
    const a = new Set(['a', 'b', 'c']);
    expect(jaccardSimilarity(a, a)).toBe(1);
  });

  it('returns 0 for disjoint sets', () => {
    const a = new Set(['a', 'b']);
    const b = new Set(['c', 'd']);
    expect(jaccardSimilarity(a, b)).toBe(0);
  });

  it('computes correct ratio for partial overlap', () => {
    const a = new Set(['a', 'b', 'c']);
    const b = new Set(['b', 'c', 'd']);
    // intersection=2, union=4 → 0.5
    expect(jaccardSimilarity(a, b)).toBe(0.5);
  });
});

describe('extractNumericFacts', () => {
  it('extracts numbers with context', () => {
    const facts = extractNumericFacts('The free tier supports 50 users.');
    expect(facts.length).toBeGreaterThan(0);
    expect(facts[0].value).toBe(50);
  });

  it('returns empty for text without numbers', () => {
    const facts = extractNumericFacts('No numbers here at all.');
    expect(facts).toHaveLength(0);
  });
});

describe('factsContradict', () => {
  it('detects contradiction when context matches but values differ', () => {
    const a = { context: 'free tier supports users', value: 50, raw: 'free tier supports 50 users' };
    const b = { context: 'free tier supports users', value: 100, raw: 'free tier supports 100 users' };
    expect(factsContradict(a, b)).toBe(true);
  });

  it('returns false when values are equal', () => {
    const a = { context: 'free tier supports users', value: 50, raw: '50 users' };
    const b = { context: 'free tier supports users', value: 50, raw: '50 users' };
    expect(factsContradict(a, b)).toBe(false);
  });

  it('returns false when context is completely different', () => {
    const a = { context: 'free tier supports users', value: 50, raw: '50 users' };
    const b = { context: 'server response time milliseconds', value: 100, raw: '100 ms' };
    expect(factsContradict(a, b)).toBe(false);
  });
});

describe('setFrontmatterField', () => {
  it('creates frontmatter when none exists', () => {
    const result = setFrontmatterField('# Hello', 'stale', 'true');
    expect(result).toContain('---\nstale: true\n---');
    expect(result).toContain('# Hello');
  });

  it('adds field to existing frontmatter', () => {
    const raw = '---\nimportance: high\n---\n# Content';
    const result = setFrontmatterField(raw, 'stale', 'true');
    expect(result).toContain('stale: true');
    expect(result).toContain('importance: high');
  });

  it('updates existing field', () => {
    const raw = '---\nimportance: high\n---\n# Content';
    const result = setFrontmatterField(raw, 'importance', 'low');
    expect(result).toContain('importance: low');
    expect(result).not.toContain('importance: high');
  });
});

describe('parseFrontmatterRaw', () => {
  it('parses frontmatter key-value pairs', () => {
    const raw = '---\nimportance: high\nstale: true\n---\nBody text';
    const { fm, body } = parseFrontmatterRaw(raw);
    expect(fm.importance).toBe('high');
    expect(fm.stale).toBe('true');
    expect(body).toBe('Body text');
  });

  it('returns empty fm when no frontmatter', () => {
    const { fm, body } = parseFrontmatterRaw('Just text');
    expect(Object.keys(fm)).toHaveLength(0);
    expect(body).toBe('Just text');
  });
});

// ---------------------------------------------------------------------------
// Integration tests: consolidation passes
// ---------------------------------------------------------------------------

describe('consolidateRole', () => {
  it('detects near-duplicate files and marks superseded_by', () => {
    const memDir = setupDir('agents', 'engineer', 'memory');
    writeFile(memDir, 'pricing-v1.md', '---\nimportance: normal\n---\nThe free tier pricing allows 50 users with basic features enabled and dashboard access.');
    writeFile(memDir, 'pricing-v2.md', '---\nimportance: normal\n---\nThe free tier pricing allows 50 users with basic features enabled and dashboard access plus API.');

    const result = consolidateRole(memDir, 'engineer');
    expect(result.scanned).toBe(2);
    expect(result.duplicatesMerged).toBe(1);

    // The older file should have superseded_by set
    const v1 = readFile(memDir, 'pricing-v1.md');
    const v2 = readFile(memDir, 'pricing-v2.md');
    // One of them should be superseded
    const eitherSuperseded = v1.includes('superseded_by') || v2.includes('superseded_by');
    expect(eitherSuperseded).toBe(true);
  });

  it('detects contradicting numeric facts', () => {
    const memDir = setupDir('agents', 'strategist', 'memory');
    // Files must be different enough to avoid dedup (Jaccard < 0.6)
    // but share a contradicting numeric fact with enough context overlap (Jaccard > 0.5)
    writeFile(memDir, 'pricing-old.md', '---\nimportance: high\n---\nMarket analysis report from January covering competitive landscape and positioning strategy for enterprise segment. The free tier plan currently allows 50 users with dashboard access and basic monitoring.');
    writeFile(memDir, 'pricing-new.md', '---\nimportance: high\n---\nQuarterly product roadmap overview for April with detailed technical architecture and deployment timeline. The free tier plan currently allows 100 users with dashboard access and basic monitoring.');

    const result = consolidateRole(memDir, 'strategist');
    expect(result.contradictionsFlagged).toBeGreaterThanOrEqual(1);

    const oldContent = readFile(memDir, 'pricing-old.md');
    const newContent = readFile(memDir, 'pricing-new.md');
    expect(oldContent).toContain('conflicts_with');
    expect(newContent).toContain('conflicts_with');
    expect(oldContent).toContain('confidence: low');
  });

  it('marks old files as stale', () => {
    const memDir = setupDir('agents', 'ops', 'memory');
    writeFile(memDir, 'old-notes.md', '---\nimportance: normal\n---\nSome old notes about the system.');

    // Use a very short threshold to trigger staleness
    const result = consolidateRole(memDir, 'ops', { staleThresholdMs: 0 });
    expect(result.staleMarked).toBe(1);

    const content = readFile(memDir, 'old-notes.md');
    expect(content).toContain('stale: true');
  });

  it('does not mark critical files as stale', () => {
    const memDir = setupDir('agents', 'ops2', 'memory');
    writeFile(memDir, 'critical.md', '---\nimportance: critical\n---\nThis is critical and must not go stale.');

    const result = consolidateRole(memDir, 'ops2', { staleThresholdMs: 0 });
    expect(result.staleMarked).toBe(0);
  });

  it('does not mark strategic-layer files as stale', () => {
    const memDir = setupDir('agents', 'ops3', 'memory');
    writeFile(memDir, 'identity.md', '---\nimportance: normal\nlayer: strategic\n---\nAgent identity.');

    const result = consolidateRole(memDir, 'ops3', { staleThresholdMs: 0 });
    expect(result.staleMarked).toBe(0);
  });

  it('decays importance over time', () => {
    const memDir = setupDir('agents', 'engineer2', 'memory');
    writeFile(memDir, 'decayable.md', '---\nimportance: high\n---\nSome content that will decay.');

    const result = consolidateRole(memDir, 'engineer2', { decayThresholdMs: 0 });
    expect(result.importanceDecayed).toBe(1);

    const content = readFile(memDir, 'decayable.md');
    expect(content).toContain('importance: normal');
  });

  it('does not decay critical importance', () => {
    const memDir = setupDir('agents', 'engineer3', 'memory');
    writeFile(memDir, 'nodecay.md', '---\nimportance: critical\n---\nCritical content never decays.');

    const result = consolidateRole(memDir, 'engineer3', { decayThresholdMs: 0 });
    expect(result.importanceDecayed).toBe(0);
  });

  it('supports dry-run mode without modifying files', () => {
    const memDir = setupDir('agents', 'drytest', 'memory');
    const original = '---\nimportance: high\n---\nSome content that would decay.';
    writeFile(memDir, 'test.md', original);

    const result = consolidateRole(memDir, 'drytest', { decayThresholdMs: 0, dryRun: true });
    expect(result.importanceDecayed).toBe(1);

    // File should be unchanged
    const content = readFile(memDir, 'test.md');
    expect(content).toBe(original);
  });

  it('handles empty directories', () => {
    const memDir = setupDir('agents', 'empty', 'memory');
    const result = consolidateRole(memDir, 'empty');
    expect(result.scanned).toBe(0);
  });

  it('handles files without frontmatter', () => {
    const memDir = setupDir('agents', 'nofm', 'memory');
    writeFile(memDir, 'plain.md', 'Just plain text with no frontmatter.');

    const result = consolidateRole(memDir, 'nofm', { staleThresholdMs: 0 });
    // Should still scan it without errors
    expect(result.scanned).toBe(1);
    // Plain file with no importance → no decay, but can go stale
    expect(result.staleMarked).toBe(1);
  });
});

describe('consolidateAll', () => {
  it('processes multiple agent roles', () => {
    const stateDir = setupDir();
    const engDir = setupDir('agents', 'engineer', 'memory');
    const stratDir = setupDir('agents', 'strategist', 'memory');
    writeFile(engDir, 'notes.md', '---\nimportance: normal\n---\nEngineering notes.');
    writeFile(stratDir, 'plan.md', '---\nimportance: normal\n---\nStrategy plan.');

    const results = consolidateAll(stateDir);
    expect(results).toHaveLength(2);
    expect(results.map(r => r.role).sort()).toEqual(['engineer', 'strategist']);
  });

  it('filters to a specific role', () => {
    const stateDir = setupDir();
    setupDir('agents', 'engineer', 'memory');
    setupDir('agents', 'strategist', 'memory');
    writeFile(join(stateDir, 'agents', 'engineer', 'memory'), 'a.md', 'content');
    writeFile(join(stateDir, 'agents', 'strategist', 'memory'), 'b.md', 'content');

    const results = consolidateAll(stateDir, { role: 'engineer' });
    expect(results).toHaveLength(1);
    expect(results[0].role).toBe('engineer');
  });

  it('writes consolidation meta file', () => {
    const stateDir = setupDir();
    setupDir('agents', 'test', 'memory');
    writeFile(join(stateDir, 'agents', 'test', 'memory'), 'a.md', 'content');

    consolidateAll(stateDir);

    const metaPath = join(stateDir, '.consolidation-meta.json');
    expect(existsSync(metaPath)).toBe(true);
    const meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
    expect(meta.lastConsolidation).toBeTruthy();
  });
});

describe('getMemoryHealth', () => {
  it('returns health report with stale/conflict/duplicate counts', () => {
    const stateDir = setupDir();
    const memDir = setupDir('agents', 'engineer', 'memory');
    writeFile(memDir, 'ok.md', '---\nimportance: normal\n---\nHealthy file.');
    writeFile(memDir, 'stale.md', '---\nstale: true\n---\nStale content.');
    writeFile(memDir, 'conflict.md', '---\nconflicts_with: other.md\n---\nConflicting.');
    writeFile(memDir, 'superseded.md', '---\nsuperseded_by: ok.md\n---\nOld content.');

    const report = getMemoryHealth(stateDir);
    expect(report.agents.engineer).toEqual({
      total: 4,
      stale: 1,
      conflicts: 1,
      duplicates: 1,
    });
  });

  it('reads lastConsolidation from meta file', () => {
    const stateDir = setupDir();
    const ts = '2026-04-13T03:00:00.000Z';
    writeFileSync(join(stateDir, '.consolidation-meta.json'), JSON.stringify({ lastConsolidation: ts }));

    const report = getMemoryHealth(stateDir);
    expect(report.lastConsolidation).toBe(ts);
  });

  it('handles missing state dir gracefully', () => {
    const report = getMemoryHealth(join(TEST_DIR, 'nonexistent'));
    expect(report.agents).toEqual({});
    expect(report.lastConsolidation).toBeNull();
  });
});
