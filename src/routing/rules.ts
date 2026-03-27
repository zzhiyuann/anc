/**
 * Declarative routing rules — loaded from YAML config.
 * All routing logic in one place, not scattered across handlers.
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { parse as parseYaml } from 'yaml';
import type { AgentRole } from '../linear/types.js';

export interface CommentRule {
  match: string;  // "@{agent}", "reply_to_agent", "has_delegate", "has_assignee", "last_active"
  target: 'mentioned_agent' | 'parent_agent' | 'delegate' | 'assignee' | 'last_agent';
}

export interface IssueRule {
  label?: string;
  project?: string;
  titlePattern?: string;
  target: AgentRole;
}

export interface RoutingConfig {
  comment_routing: CommentRule[];
  comment_default: 'skip' | AgentRole;
  issue_routing: IssueRule[];
  issue_default: AgentRole;
  self_prefixes: string[];  // e.g. ["self:", "note:"]
  agent_roles: string[];    // known roles for @mention detection
}

let cachedConfig: RoutingConfig | null = null;

export function loadRoutingConfig(configDir?: string): RoutingConfig {
  if (cachedConfig) return cachedConfig;

  const dir = configDir ?? join(process.cwd(), 'config');
  const path = join(dir, 'routing.yaml');

  if (existsSync(path)) {
    const raw = readFileSync(path, 'utf-8');
    cachedConfig = parseYaml(raw) as RoutingConfig;
  } else {
    // Sensible defaults
    cachedConfig = {
      comment_routing: [
        { match: '@{agent}', target: 'mentioned_agent' },
        { match: 'reply_to_agent', target: 'parent_agent' },
        { match: 'has_delegate', target: 'delegate' },
        { match: 'has_assignee', target: 'assignee' },
        { match: 'last_active', target: 'last_agent' },
      ],
      comment_default: 'skip',
      issue_routing: [
        { label: 'agent:cc', target: 'engineer' },
        { label: 'Bug', target: 'engineer' },
        { label: 'Plan', target: 'strategist' },
      ],
      issue_default: 'ops',
      self_prefixes: ['self:', 'note:'],
      agent_roles: ['engineer', 'strategist', 'ops'],
    };
  }

  return cachedConfig;
}

/** Build a regex matching all known agent roles for @mention detection.
 *  Matches both plain text (@Engineer) and Linear's format. */
export function buildMentionRegex(config: RoutingConfig): RegExp {
  const escaped = config.agent_roles.map(r => r.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`@(${escaped.join('|')})\\b`, 'i');
}

/** Detect @mention by Linear user ID — Linear embeds mentions as user IDs in webhook payload.
 *  Returns the agent role if a known agent is mentioned, null otherwise. */
export function detectMentionByUserId(body: string, agents: Array<{ role: string; linearUserId: string }>): string | null {
  for (const agent of agents) {
    if (!agent.linearUserId) continue;
    // Linear formats mentions as links or embedded user references containing the user ID
    if (body.includes(agent.linearUserId)) {
      return agent.role;
    }
  }
  return null;
}

/** Check if comment is a self-note (should not trigger agent) */
export function isSelfNote(body: string, config: RoutingConfig): boolean {
  const trimmed = body.trimStart().toLowerCase();
  return config.self_prefixes.some(p => trimmed.startsWith(p.toLowerCase()));
}

export function _resetCache(): void {
  cachedConfig = null;
}
