/**
 * Composable persona builder.
 * Assembles agent system prompt from small, reusable fragments.
 * Supports layered memory (strategic/domain/project/retro/shared),
 * frontmatter-based importance, and a lightweight worker persona mode.
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { AgentConfig, AgentRole } from '../linear/types.js';
import { getAgent } from './registry.js';
import { getConfig } from '../linear/types.js';

// --- Token budget (chars) per layer ---
const STRATEGIC_MAX_FILES = 5;
const STRATEGIC_MAX_CHARS_PER_FILE = 2000;

const DOMAIN_MAX_FILES = 15;
const DOMAIN_MAX_CHARS_PER_FILE = 3000;
const DOMAIN_BUDGET = 15_000;  // cumulative char budget

const PROJECT_MAX_FILES_PER_PROJECT = 10;
const PROJECT_MAX_CHARS_PER_FILE = 2000;
const PROJECT_BUDGET = 20_000; // cumulative after strategic+domain

const MAX_RETRO_FILES = 3;
const TOTAL_BUDGET = 25_000;   // hard cap for retro+shared combined

const MAX_SHARED_FILES = 5;
const MAX_SHARED_CHARS_PER_FILE = 2000;

// --- Frontmatter parsing ---

export type Importance = 'critical' | 'high' | 'normal' | 'low';
export type MemoryLayer = 'strategic' | 'domain' | 'project';

export interface ParsedFrontmatter {
  importance: Importance;
  layer?: MemoryLayer;
  project?: string;
  tags?: string[];
  updated?: string;
  content: string;
}

export interface MemoryFile {
  name: string;
  content: string;
  importance: Importance;
  layer: MemoryLayer;
  project?: string;
  tags?: string[];
}

const IMPORTANCE_ORDER: Record<string, number> = { critical: 0, high: 1, normal: 2, low: 3 };

export function parseFrontmatter(raw: string): ParsedFrontmatter {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { importance: 'normal', content: raw };

  const frontmatter = match[1];
  const content = match[2];

  const impMatch = frontmatter.match(/importance:\s*(critical|high|normal|low)/);
  const importance = (impMatch?.[1] ?? 'normal') as Importance;

  const layerMatch = frontmatter.match(/layer:\s*(strategic|domain|project)/);
  const layer = layerMatch?.[1] as MemoryLayer | undefined;

  const projMatch = frontmatter.match(/project:\s*(.+)/);
  const project = projMatch?.[1]?.trim();

  const tagsMatch = frontmatter.match(/tags:\s*\[([^\]]*)\]/);
  const tags = tagsMatch?.[1]?.split(',').map(t => t.trim()).filter(Boolean);

  const updatedMatch = frontmatter.match(/updated:\s*(\S+)/);
  const updated = updatedMatch?.[1];

  return { importance, layer, project, tags, updated, content };
}

/** Build the full system prompt for an agent */
export function buildPersona(role: AgentRole, projectSlug?: string): string {
  const agent = getAgent(role);
  if (!agent) throw new Error(`Unknown agent role: ${role}`);

  const parts: string[] = [];

  // 1. Composable persona fragments
  for (const file of agent.personaFiles) {
    const resolved = resolvePersonaPath(file);
    if (resolved && existsSync(resolved)) {
      parts.push(readFileSync(resolved, 'utf-8').trim());
    }
  }

  // 2. Agent identity header
  parts.unshift(buildIdentityHeader(agent));

  // 3. Layered memory injection
  const memorySection = buildLayeredMemorySection(role, projectSlug);
  if (memorySection) parts.push(memorySection);

  // 4. SDK reference (auto-appended)
  parts.push(buildSdkReference());

  return parts.join('\n\n---\n\n');
}

/**
 * Build a lightweight worker persona — no memory loading, no retrospectives.
 * For simple tasks that don't need the full agent identity.
 */
export function buildWorkerPersona(issueKey: string, issueTitle: string, issueDescription?: string): string {
  return `# Worker Agent

You are an ephemeral worker assigned to a specific task. You have no persistent memory or identity.

## Your Task
**${issueKey}: ${issueTitle}**

${issueDescription || 'See the issue description for details.'}

## Instructions
- Complete the assigned task autonomously
- Write PROGRESS.md with incremental updates
- When done, write HANDOFF.md with: summary, files changed, testing notes
- If blocked, write BLOCKED.md explaining what you need
- You do NOT have a persistent persona — focus entirely on this task

## Tools Available
\`\`\`bash
anc comment <issue-key> "message"    # Post comment as yourself
anc status <issue-key> "Status"      # Change issue status
\`\`\``;
}

// --- Internal builders ---

function buildIdentityHeader(agent: AgentConfig): string {
  return `# ${agent.name}

You are **${agent.name}** (role: \`${agent.role}\`) in an AI-native company.
Your identity is persistent across sessions. Your memory compounds over time.

**CRITICAL**: For ALL Linear operations, use the \`anc\` CLI tool (never MCP Linear tools — those use the CEO's personal token).`;
}

/**
 * Determine the layer for a file based on its directory location.
 * Used as the default when frontmatter doesn't specify a layer.
 */
function layerFromDir(dirName: string): MemoryLayer {
  if (dirName === 'strategic') return 'strategic';
  if (dirName === 'domain') return 'domain';
  if (dirName === 'project') return 'project';
  // Backward compat: files in flat memory dir → domain
  return 'domain';
}

/**
 * Scan a directory for .md files and parse them into MemoryFile entries.
 * The defaultLayer is applied when frontmatter doesn't specify a layer.
 */
function scanMemoryDir(
  dirPath: string,
  defaultLayer: MemoryLayer,
  maxCharsPerFile: number,
  namePrefix?: string,
  defaultProject?: string,
): MemoryFile[] {
  if (!existsSync(dirPath)) return [];

  let files: string[];
  try {
    files = readdirSync(dirPath).filter(f => f.endsWith('.md')).sort();
  } catch {
    return [];
  }

  const results: MemoryFile[] = [];
  for (const file of files) {
    const raw = readFileSync(join(dirPath, file), 'utf-8').trim();
    if (raw.length === 0) continue;

    const parsed = parseFrontmatter(raw);
    const truncated = parsed.content.length > maxCharsPerFile
      ? parsed.content.substring(0, maxCharsPerFile) + '\n...(truncated)'
      : parsed.content;

    results.push({
      name: namePrefix ? `${namePrefix}/${file.replace('.md', '')}` : file.replace('.md', ''),
      content: truncated,
      importance: parsed.importance,
      layer: parsed.layer ?? defaultLayer,
      project: parsed.project ?? defaultProject,
      tags: parsed.tags,
    });
  }
  return results;
}

/**
 * Build the layered memory section for injection into the persona prompt.
 *
 * Layer 1: Strategic (always loaded, never trimmed)
 * Layer 2: Domain (loaded by importance until budget)
 * Layer 3: Project (loaded for matching project only)
 * Layer 4: Retrospectives (last N)
 * Layer 5: Shared company knowledge (by importance)
 */
function buildLayeredMemorySection(role: AgentRole, projectSlug?: string): string | null {
  const config = getConfig();
  const memDir = join(config.stateDir, 'agents', role, 'memory');
  const retroDir = join(config.stateDir, 'agents', role, 'retrospectives');

  // Detect if layered structure exists (subdirectories)
  const hasLayeredStructure = existsSync(join(memDir, 'strategic'))
    || existsSync(join(memDir, 'domain'))
    || existsSync(join(memDir, 'project'));

  const parts: string[] = [];
  let totalChars = 0;

  // --- Layer 1: Strategic (always loaded) ---
  let strategicFiles: MemoryFile[] = [];
  if (hasLayeredStructure) {
    strategicFiles = scanMemoryDir(join(memDir, 'strategic'), 'strategic', STRATEGIC_MAX_CHARS_PER_FILE);
  }

  // Also collect files from flat dir or other locations that have frontmatter layer: strategic
  if (!hasLayeredStructure && existsSync(memDir)) {
    const flatFiles = scanMemoryDir(memDir, 'domain', DOMAIN_MAX_CHARS_PER_FILE);
    strategicFiles = flatFiles.filter(f => f.layer === 'strategic');
  }

  strategicFiles = strategicFiles
    .sort((a, b) => (IMPORTANCE_ORDER[a.importance] ?? 2) - (IMPORTANCE_ORDER[b.importance] ?? 2))
    .slice(0, STRATEGIC_MAX_FILES);

  if (strategicFiles.length > 0) {
    parts.push('## Strategic Knowledge (always loaded)\n');
    for (const mem of strategicFiles) {
      const tag = mem.importance !== 'normal' ? ` [${mem.importance}]` : '';
      parts.push(`### ${mem.name}${tag}\n\n${mem.content}`);
      totalChars += mem.content.length;
    }
  }

  // --- Layer 2: Domain knowledge (loaded by importance until budget) ---
  let domainFiles: MemoryFile[] = [];
  if (hasLayeredStructure) {
    domainFiles = scanMemoryDir(join(memDir, 'domain'), 'domain', DOMAIN_MAX_CHARS_PER_FILE);
  } else if (existsSync(memDir)) {
    // Backward compat: flat files not tagged as strategic → domain
    const flatFiles = scanMemoryDir(memDir, 'domain', DOMAIN_MAX_CHARS_PER_FILE);
    domainFiles = flatFiles.filter(f => f.layer === 'domain');
  }

  domainFiles.sort((a, b) => (IMPORTANCE_ORDER[a.importance] ?? 2) - (IMPORTANCE_ORDER[b.importance] ?? 2));

  const domainLoaded: MemoryFile[] = [];
  for (const mem of domainFiles) {
    if (domainLoaded.length >= DOMAIN_MAX_FILES) break;
    if (totalChars + mem.content.length > DOMAIN_BUDGET) break;
    domainLoaded.push(mem);
    totalChars += mem.content.length;
  }

  if (domainLoaded.length > 0) {
    parts.push('## Domain Expertise\n');
    for (const mem of domainLoaded) {
      const tag = mem.importance !== 'normal' ? ` [${mem.importance}]` : '';
      parts.push(`### ${mem.name}${tag}\n\n${mem.content}`);
    }
  }

  // --- Layer 3: Project context (only for matching project) ---
  if (projectSlug) {
    const projectDir = join(memDir, 'project', projectSlug);
    let projectFiles = scanMemoryDir(projectDir, 'project', PROJECT_MAX_CHARS_PER_FILE, undefined, projectSlug);

    projectFiles.sort((a, b) => (IMPORTANCE_ORDER[a.importance] ?? 2) - (IMPORTANCE_ORDER[b.importance] ?? 2));

    const projectLoaded: MemoryFile[] = [];
    for (const mem of projectFiles) {
      if (projectLoaded.length >= PROJECT_MAX_FILES_PER_PROJECT) break;
      if (totalChars + mem.content.length > PROJECT_BUDGET) break;
      projectLoaded.push(mem);
      totalChars += mem.content.length;
    }

    if (projectLoaded.length > 0) {
      parts.push(`## Project Context: ${projectSlug}\n`);
      for (const mem of projectLoaded) {
        const tag = mem.importance !== 'normal' ? ` [${mem.importance}]` : '';
        parts.push(`### ${mem.name}${tag}\n\n${mem.content}`);
      }
    }
  }

  // --- Layer 4: Retrospectives (last N) ---
  if (existsSync(retroDir)) {
    const retroFiles = readdirSync(retroDir)
      .filter(f => f.endsWith('.md'))
      .sort()
      .reverse()
      .slice(0, MAX_RETRO_FILES);

    if (retroFiles.length > 0) {
      parts.push('## Recent Retrospectives\n');
      for (const file of retroFiles) {
        const content = readFileSync(join(retroDir, file), 'utf-8').trim();
        if (totalChars + content.length > TOTAL_BUDGET) break;
        const truncated = content.length > 500 ? content.substring(0, 500) + '\n...(truncated)' : content;
        parts.push(`### ${file.replace('.md', '')}\n\n${truncated}`);
        totalChars += truncated.length;
      }
    }
  }

  // --- Layer 5: Shared company knowledge ---
  const sharedDir = join(homedir(), '.anc', 'memory', 'shared');
  if (existsSync(sharedDir)) {
    const sharedFiles = scanMemoryDir(sharedDir, 'domain', MAX_SHARED_CHARS_PER_FILE, 'shared')
      .sort((a, b) => (IMPORTANCE_ORDER[a.importance] ?? 2) - (IMPORTANCE_ORDER[b.importance] ?? 2))
      .slice(0, MAX_SHARED_FILES);

    const sharedLoaded: MemoryFile[] = [];
    for (const mem of sharedFiles) {
      if (totalChars + mem.content.length > TOTAL_BUDGET) break;
      sharedLoaded.push(mem);
      totalChars += mem.content.length;
    }

    if (sharedLoaded.length > 0) {
      parts.push('## Shared Company Knowledge\n');
      for (const mem of sharedLoaded) {
        const tag = mem.importance !== 'normal' ? ` [${mem.importance}]` : '';
        parts.push(`### ${mem.name}${tag}\n\n${mem.content}`);
      }
    }
  }

  if (parts.length === 0) return null;
  return parts.join('\n\n');
}

function buildSdkReference(): string {
  return `## ANC SDK Reference

\`\`\`bash
anc comment <issue-key> "message"              # Post comment as yourself
anc dispatch <role> <issue-key> "context"       # Start another agent on this issue
anc handoff <role> <issue-key> "what to do"     # Sequential: you finish, they continue
anc ask <role> <issue-key> "question"           # Async question to another agent
anc status <issue-key> "Status"                 # Change issue status
anc create-sub <parent-key> "Title" "Desc"      # Create sub-issue (always linked)
anc team-status                                 # Who's working on what
anc group "message"                             # Post to company Discord
anc memory write <layer> [project] <filename>   # Persist knowledge (strategic/domain/project)
\`\`\`

**Completion**: Write HANDOFF.md in your workspace root when done. The system detects it automatically.`;
}

function resolvePersonaPath(file: string): string | null {
  // Try relative to project root first
  const fromRoot = join(process.cwd(), file);
  if (existsSync(fromRoot)) return fromRoot;

  // Try relative to config dir
  const fromConfig = join(process.cwd(), 'config', file);
  if (existsSync(fromConfig)) return fromConfig;

  return null;
}
