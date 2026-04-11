/**
 * Composable persona builder.
 * Assembles agent system prompt from small, reusable fragments.
 * Supports cross-agent shared memory, retrospectives, frontmatter-based importance,
 * and a lightweight worker persona mode.
 */

import { readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { AgentConfig, AgentRole } from '../linear/types.js';
import { getAgent } from './registry.js';
import { getConfig } from '../linear/types.js';

const MAX_TOTAL_MEMORIES = 20;  // hard cap to prevent token explosion
const MAX_SHARED_FILES = 5;
const MAX_SHARED_CHARS = 2000;
const MAX_RETRO_FILES = 3;

// --- Frontmatter parsing ---

interface MemoryFile {
  name: string;
  content: string;
  importance: 'critical' | 'high' | 'normal' | 'low';
}

const IMPORTANCE_ORDER: Record<string, number> = { critical: 0, high: 1, normal: 2, low: 3 };

function parseFrontmatter(raw: string): { importance: MemoryFile['importance']; content: string } {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { importance: 'normal', content: raw };

  const frontmatter = match[1];
  const content = match[2];

  const impMatch = frontmatter.match(/importance:\s*(critical|high|normal|low)/);
  const importance = (impMatch?.[1] ?? 'normal') as MemoryFile['importance'];

  return { importance, content };
}

/** Build the full system prompt for an agent */
export function buildPersona(role: AgentRole): string {
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

  // 3. Accumulated memory (agent-specific + shared, sorted by importance)
  const memorySection = buildMemorySection(role);
  if (memorySection) parts.push(memorySection);

  // 4. Retrospectives (last 3)
  const retroSection = buildRetroSection(role);
  if (retroSection) parts.push(retroSection);

  // 5. SDK reference (auto-appended)
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

function buildMemorySection(role: AgentRole): string | null {
  const config = getConfig();
  const allMemories: MemoryFile[] = [];

  // Agent-specific memory
  const memDir = join(config.stateDir, 'agents', role, 'memory');
  if (existsSync(memDir)) {
    const files = readdirSync(memDir).filter(f => f.endsWith('.md'));
    for (const file of files) {
      const raw = readFileSync(join(memDir, file), 'utf-8').trim();
      if (raw.length > 0) {
        const { importance, content } = parseFrontmatter(raw);
        allMemories.push({ name: file.replace('.md', ''), content, importance });
      }
    }
  }

  // Cross-agent shared memory from ~/.anc/memory/shared/
  const sharedDir = join(homedir(), '.anc', 'memory', 'shared');
  if (existsSync(sharedDir)) {
    const sharedFiles = readdirSync(sharedDir).filter(f => f.endsWith('.md')).slice(0, MAX_SHARED_FILES);
    for (const file of sharedFiles) {
      const raw = readFileSync(join(sharedDir, file), 'utf-8').trim();
      if (raw.length > 0) {
        const { importance, content } = parseFrontmatter(raw);
        const truncated = content.length > MAX_SHARED_CHARS
          ? content.substring(0, MAX_SHARED_CHARS) + '\n...(truncated)'
          : content;
        allMemories.push({ name: `shared/${file.replace('.md', '')}`, content: truncated, importance });
      }
    }
  }

  if (allMemories.length === 0) return null;

  // Sort by importance (critical first, low last)
  allMemories.sort((a, b) => (IMPORTANCE_ORDER[a.importance] ?? 2) - (IMPORTANCE_ORDER[b.importance] ?? 2));

  // Cap total memories
  const capped = allMemories.slice(0, MAX_TOTAL_MEMORIES);

  const parts = ['## Your Accumulated Knowledge\n'];
  for (const mem of capped) {
    const tag = mem.importance !== 'normal' ? ` [${mem.importance}]` : '';
    parts.push(`### ${mem.name}${tag}\n\n${mem.content}`);
  }

  return parts.join('\n\n');
}

function buildRetroSection(role: AgentRole): string | null {
  const config = getConfig();
  const retroDir = join(config.stateDir, 'agents', role, 'retrospectives');
  if (!existsSync(retroDir)) return null;

  const retroFiles = readdirSync(retroDir)
    .filter(f => f.endsWith('.md'))
    .sort()
    .reverse()
    .slice(0, MAX_RETRO_FILES);

  if (retroFiles.length === 0) return null;

  const parts = ['## Recent Retrospectives\n'];
  for (const file of retroFiles) {
    const content = readFileSync(join(retroDir, file), 'utf-8').trim();
    // Truncate individual retrospectives to 500 chars
    const truncated = content.length > 500 ? content.substring(0, 500) + '\n...(truncated)' : content;
    parts.push(`### ${file.replace('.md', '')}\n\n${truncated}`);
  }

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
