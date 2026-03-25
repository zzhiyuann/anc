/**
 * Agent registry — load roster from YAML config.
 * Single source for "who are the agents?"
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { parse as parseYaml } from 'yaml';
import type { AgentConfig, AgentRole } from '../linear/types.js';

let registry: AgentConfig[] | null = null;

interface AgentsYaml {
  agents: Record<string, {
    name: string;
    model: 'claude-code';
    linearUserId: string;
    oauthTokenPath?: string;
    maxConcurrency?: number;
    dutySlots?: number;
    base: string;
    role: string;
    protocols: string[];
  }>;
}

export function loadAgentRegistry(configDir?: string): AgentConfig[] {
  if (registry) return registry;

  const dir = configDir ?? join(process.cwd(), 'config');
  const path = join(dir, 'agents.yaml');

  if (!existsSync(path)) {
    // Default 3-agent roster
    registry = [
      { name: 'Engineer', role: 'engineer', model: 'claude-code', linearUserId: '', personaFiles: [], maxConcurrency: 3, dutySlots: 1 },
      { name: 'Strategist', role: 'strategist', model: 'claude-code', linearUserId: '', personaFiles: [], maxConcurrency: 2, dutySlots: 1 },
      { name: 'Ops', role: 'ops', model: 'claude-code', linearUserId: '', personaFiles: [], maxConcurrency: 2, dutySlots: 1 },
    ];
    return registry;
  }

  const raw = parseYaml(readFileSync(path, 'utf-8')) as AgentsYaml;
  registry = Object.entries(raw.agents).map(([role, cfg]) => ({
    name: cfg.name,
    role,
    model: cfg.model,
    linearUserId: cfg.linearUserId,
    oauthTokenPath: cfg.oauthTokenPath,
    maxConcurrency: cfg.maxConcurrency ?? 3,
    dutySlots: cfg.dutySlots ?? 1,
    personaFiles: [cfg.base, cfg.role, ...cfg.protocols],
  }));

  return registry;
}

export function getRegisteredAgents(): AgentConfig[] {
  return loadAgentRegistry();
}

export function getAgent(role: AgentRole): AgentConfig | undefined {
  return loadAgentRegistry().find(a => a.role === role);
}

export function getAgentByLinearUserId(userId: string): AgentConfig | undefined {
  return loadAgentRegistry().find(a => a.linearUserId === userId);
}

export function isKnownRole(role: string): boolean {
  return loadAgentRegistry().some(a => a.role === role.toLowerCase());
}

export function _resetRegistry(): void {
  registry = null;
}
