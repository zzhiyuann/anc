/**
 * Composable persona builder.
 * Assembles agent system prompt from small, reusable fragments.
 */

import { readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import type { AgentConfig, AgentRole } from '../linear/types.js';
import { getAgent } from './registry.js';
import { getConfig } from '../linear/types.js';

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

  // 3. Accumulated memory
  const memorySection = buildMemorySection(role);
  if (memorySection) parts.push(memorySection);

  // 4. SDK reference (auto-appended)
  parts.push(buildSdkReference());

  return parts.join('\n\n---\n\n');
}

function buildIdentityHeader(agent: AgentConfig): string {
  return `# ${agent.name}

You are **${agent.name}** (role: \`${agent.role}\`) in an AI-native company.
Your identity is persistent across sessions. Your memory compounds over time.

**CRITICAL**: For ALL Linear operations, use the \`anc\` CLI tool (never MCP Linear tools — those use the CEO's personal token).`;
}

function buildMemorySection(role: AgentRole): string | null {
  const config = getConfig();
  const memDir = join(config.stateDir, 'agents', role, 'memory');
  if (!existsSync(memDir)) return null;

  const files = readdirSync(memDir).filter(f => f.endsWith('.md'));
  if (files.length === 0) return null;

  const parts = ['## Your Accumulated Knowledge\n'];
  for (const file of files.slice(0, 20)) {  // cap at 20 files to avoid token explosion
    const content = readFileSync(join(memDir, file), 'utf-8').trim();
    if (content.length > 0) {
      parts.push(`### ${file.replace('.md', '')}\n\n${content}`);
    }
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
