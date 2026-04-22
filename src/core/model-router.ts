/**
 * Model Router — task complexity classification + model selection.
 *
 * Routes tasks to the cheapest model tier that can handle them reliably.
 * Conservative by default: falls back to Opus when uncertain.
 *
 * Cost multipliers (relative to Opus baseline):
 *   Opus:   1.0x  ($0.50/task estimate)
 *   Sonnet: 0.2x  ($0.10/task estimate)
 *   Haiku:  0.07x ($0.03/task estimate)
 */

import { readFileSync, existsSync, statSync } from 'fs';
import { join } from 'path';
import { parse as parseYaml } from 'yaml';
import { createLogger } from './logger.js';

const log = createLogger('model-router');

// --- Types ---

export type ModelTier = 'opus' | 'sonnet' | 'haiku';

export interface ModelDecision {
  model: ModelTier;
  reason: string;
  estimatedCostMultiplier: number;
}

export interface TaskInput {
  title: string;
  description: string | null;
  priority: number;
  source: string;
  parentTaskId: string | null;
}

// --- Cost multipliers ---

const COST_MULTIPLIERS: Record<ModelTier, number> = {
  opus: 1.0,
  sonnet: 0.2,
  haiku: 0.07,
};

// --- Claude Code model identifiers ---

export const MODEL_IDS: Record<ModelTier, string> = {
  opus: 'claude-opus-4-6',
  sonnet: 'claude-sonnet-4-6',
  haiku: 'claude-haiku-4-5',
};

// --- Haiku keyword triggers ---

const HAIKU_KEYWORDS = [
  'triage', 'label', 'categorize', 'summarize', 'format',
  'healthcheck', 'health check', 'ping', 'status check',
];

// --- Per-role model override cache ---

interface AgentModelOverrides {
  [role: string]: ModelTier | undefined;
}

let cachedOverrides: AgentModelOverrides | null = null;
let cachedOverridesMtime = 0;

function loadRoleOverrides(): AgentModelOverrides {
  const configPath = join(process.cwd(), 'config', 'agents.yaml');
  if (!existsSync(configPath)) return {};

  try {
    const stat = statSync(configPath);
    if (cachedOverrides && stat.mtimeMs === cachedOverridesMtime) return cachedOverrides;

    const raw = parseYaml(readFileSync(configPath, 'utf-8')) as {
      agents: Record<string, { modelTier?: string }>;
    };
    const overrides: AgentModelOverrides = {};
    for (const [role, cfg] of Object.entries(raw.agents ?? {})) {
      if (cfg.modelTier && isValidTier(cfg.modelTier)) {
        overrides[role] = cfg.modelTier as ModelTier;
      }
    }
    cachedOverrides = overrides;
    cachedOverridesMtime = stat.mtimeMs;
    return overrides;
  } catch {
    return {};
  }
}

function isValidTier(value: string): value is ModelTier {
  return value === 'opus' || value === 'sonnet' || value === 'haiku';
}

/** Clear cached overrides (for testing or config reload) */
export function _resetOverrideCache(): void {
  cachedOverrides = null;
  cachedOverridesMtime = 0;
}

// --- Main selection logic ---

/**
 * Select the optimal model tier for a task.
 *
 * @param task - Task metadata for classification
 * @param agentRole - Optional agent role for per-role override lookup
 * @returns ModelDecision with the selected tier, reason, and cost multiplier
 */
export function selectModel(task: TaskInput, agentRole?: string): ModelDecision {
  // 1. Per-role override from agents.yaml (highest priority)
  if (agentRole) {
    const overrides = loadRoleOverrides();
    const forced = overrides[agentRole];
    if (forced) {
      return {
        model: forced,
        reason: `role override: ${agentRole} forced to ${forced}`,
        estimatedCostMultiplier: COST_MULTIPLIERS[forced],
      };
    }
  }

  // 2. Opus: CEO-assigned or high priority (1-2)
  if (task.priority <= 2) {
    return {
      model: 'opus',
      reason: `high priority (${task.priority})`,
      estimatedCostMultiplier: COST_MULTIPLIERS.opus,
    };
  }

  // 3. Opus: parent tasks with sub-issues (complex coordination)
  if (task.parentTaskId === null && task.source === 'ceo') {
    return {
      model: 'opus',
      reason: 'CEO-dispatched task',
      estimatedCostMultiplier: COST_MULTIPLIERS.opus,
    };
  }

  // 4. Opus: long descriptions suggest complex tasks
  if (task.description && task.description.length > 200) {
    return {
      model: 'opus',
      reason: `complex task (description ${task.description.length} chars)`,
      estimatedCostMultiplier: COST_MULTIPLIERS.opus,
    };
  }

  // 5. Haiku: low priority (5) or duty tasks
  if (task.priority >= 5) {
    return {
      model: 'haiku',
      reason: `low priority (${task.priority})`,
      estimatedCostMultiplier: COST_MULTIPLIERS.haiku,
    };
  }

  // 6. Haiku: keyword-based detection for trivial/mechanical work
  const combined = `${task.title} ${task.description ?? ''}`.toLowerCase();
  const matchedKeyword = HAIKU_KEYWORDS.find(kw => combined.includes(kw));
  if (matchedKeyword) {
    return {
      model: 'haiku',
      reason: `trivial task (keyword: "${matchedKeyword}")`,
      estimatedCostMultiplier: COST_MULTIPLIERS.haiku,
    };
  }

  // 7. Haiku: standing duty sources
  if (task.source === 'ops-pulse' || task.source === 'healthcheck' || task.source === 'duty') {
    return {
      model: 'haiku',
      reason: `standing duty (source: ${task.source})`,
      estimatedCostMultiplier: COST_MULTIPLIERS.haiku,
    };
  }

  // 8. Default: Sonnet for standard work (priority 3-4)
  return {
    model: 'sonnet',
    reason: `standard work (priority ${task.priority})`,
    estimatedCostMultiplier: COST_MULTIPLIERS.sonnet,
  };
}

/**
 * Get the estimated cost in USD for a given model tier.
 */
export function getModelCostEstimate(tier: ModelTier): number {
  switch (tier) {
    case 'opus': return 0.50;
    case 'sonnet': return 0.10;
    case 'haiku': return 0.03;
  }
}
