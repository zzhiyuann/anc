/**
 * Budget tracker — daily and per-agent spending limits with SQLite persistence.
 * Loads config from config/budget.yaml, stores spend data in budget_log table.
 * Emits system:budget-alert when approaching limits.
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { parse as parseYaml } from 'yaml';
import { getDb } from './db.js';
import { bus } from '../bus.js';
import { createLogger } from './logger.js';

const log = createLogger('budget');

interface AgentBudget {
  limit: number;
  alertAt: number;
}

interface BudgetConfig {
  daily: { limit: number; alertAt: number };
  agents: Record<string, AgentBudget>;
}

const DEFAULT_CONFIG: BudgetConfig = {
  daily: { limit: 50, alertAt: 0.80 },
  agents: {},
};

let cachedConfig: BudgetConfig | null = null;

function loadConfig(): BudgetConfig {
  if (cachedConfig) return cachedConfig;

  const configPath = join(process.cwd(), 'config', 'budget.yaml');
  if (!existsSync(configPath)) {
    log.debug('No budget.yaml found, using defaults');
    return DEFAULT_CONFIG;
  }

  try {
    const raw = readFileSync(configPath, 'utf-8');
    const parsed = parseYaml(raw) as BudgetConfig;
    cachedConfig = {
      daily: { limit: parsed.daily?.limit ?? 50, alertAt: parsed.daily?.alertAt ?? 0.80 },
      agents: parsed.agents ?? {},
    };
    return cachedConfig;
  } catch (err) {
    log.warn(`Failed to parse budget.yaml: ${(err as Error).message}`);
    return DEFAULT_CONFIG;
  }
}

/** Clear cached config (for testing or config reload) */
export function reloadConfig(): void {
  cachedConfig = null;
}

/**
 * Rough pre-spawn cost estimate for budget gating (USD).
 * Used by the resolve gate before we know the true cost.
 * Values are conservative — real cost is recorded at completion via recordSpend().
 */
export function estimateCost(agentRole: string): number {
  switch (agentRole) {
    case 'engineer': return 0.50;
    case 'strategist': return 0.30;
    case 'ops': return 0.10;
    default: return 0.25;
  }
}

/** Check if an agent can spend the estimated cost */
export function canSpend(agentRole: string, estimatedCost: number): { allowed: boolean; reason?: string } {
  const config = loadConfig();
  const todaySpend = getTodaySpend();

  // Check daily limit
  if (todaySpend.total + estimatedCost > config.daily.limit) {
    return { allowed: false, reason: `Daily limit reached ($${todaySpend.total.toFixed(2)}/$${config.daily.limit})` };
  }

  // Check per-agent limit
  const agentConfig = config.agents[agentRole];
  if (agentConfig) {
    const agentSpend = todaySpend.byAgent[agentRole] ?? 0;
    if (agentSpend + estimatedCost > agentConfig.limit) {
      return { allowed: false, reason: `${agentRole} limit reached ($${agentSpend.toFixed(2)}/$${agentConfig.limit})` };
    }
  }

  return { allowed: true };
}

/** Record a spend event and check alert thresholds */
export function recordSpend(agentRole: string, issueKey: string, tokens: number, costUsd: number): void {
  getDb().prepare(
    'INSERT INTO budget_log (agent_role, issue_key, tokens, cost_usd) VALUES (?, ?, ?, ?)'
  ).run(agentRole, issueKey, tokens, costUsd);

  // Check thresholds and emit alerts
  const config = loadConfig();
  const todaySpend = getTodaySpend();

  const dailyPercent = todaySpend.total / config.daily.limit;
  if (dailyPercent >= config.daily.alertAt) {
    bus.emit('system:budget-alert', {
      spent: todaySpend.total,
      limit: config.daily.limit,
      percent: Math.round(dailyPercent * 100),
    });
  }

  const agentConfig = config.agents[agentRole];
  if (agentConfig) {
    const agentSpend = todaySpend.byAgent[agentRole] ?? 0;
    const agentPercent = agentSpend / agentConfig.limit;
    if (agentPercent >= agentConfig.alertAt) {
      bus.emit('system:budget-alert', {
        agentRole,
        spent: agentSpend,
        limit: agentConfig.limit,
        percent: Math.round(agentPercent * 100),
      });
    }
  }
}

/** Get spend summary for today + per agent + recent history */
export function getSummary(): { today: { spent: number; limit: number }; perAgent: Record<string, { spent: number; limit: number }>; history: Array<{ date: string; total: number }> } {
  const config = loadConfig();
  const todaySpend = getTodaySpend();

  const perAgent: Record<string, { spent: number; limit: number }> = {};
  for (const [role, agentConf] of Object.entries(config.agents)) {
    perAgent[role] = { spent: todaySpend.byAgent[role] ?? 0, limit: agentConf.limit };
  }
  // Include agents with spend but no config
  for (const [role, spent] of Object.entries(todaySpend.byAgent)) {
    if (!perAgent[role]) {
      perAgent[role] = { spent, limit: Infinity };
    }
  }

  // Last 7 days of history
  const history = getDb().prepare(`
    SELECT DATE(created_at) as date, SUM(cost_usd) as total
    FROM budget_log
    WHERE created_at >= datetime('now', '-7 days')
    GROUP BY DATE(created_at)
    ORDER BY date DESC
  `).all() as Array<{ date: string; total: number }>;

  return {
    today: { spent: todaySpend.total, limit: config.daily.limit },
    perAgent,
    history,
  };
}

// --- Internal helpers ---

function getTodaySpend(): { total: number; byAgent: Record<string, number> } {
  const rows = getDb().prepare(`
    SELECT agent_role, SUM(cost_usd) as total
    FROM budget_log
    WHERE DATE(created_at) = DATE('now')
    GROUP BY agent_role
  `).all() as Array<{ agent_role: string; total: number }>;

  let total = 0;
  const byAgent: Record<string, number> = {};
  for (const row of rows) {
    byAgent[row.agent_role] = row.total;
    total += row.total;
  }

  return { total, byAgent };
}
