/**
 * Standing Duties Engine — proactive behaviors driven by YAML config.
 *
 * Two trigger types:
 *   cron: "2h" / "30m" — checked on every system:tick, fires when interval elapsed
 *   event: "agent:failed" — fires immediately when bus event occurs
 *
 * Adding new proactive behavior = adding a YAML entry. No code changes.
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { parse as parseYaml } from 'yaml';
import { bus } from '../bus.js';
import { resolveSession } from '../runtime/runner.js';
import { hasDutyCapacity } from '../runtime/health.js';
import chalk from 'chalk';

// --- Types ---

interface DutyConfig {
  id: string;
  role: string;
  trigger: { cron?: string; event?: string };
  issuePrefix: string;
  prompt: string;
}

interface DutyState {
  lastRun: number;
  intervalMs: number;
}

// --- State ---

const dutyStates = new Map<string, DutyState>();
let duties: DutyConfig[] = [];

// --- Config loading ---

function loadDuties(configDir?: string): DutyConfig[] {
  const dir = configDir ?? join(process.cwd(), 'config');
  const path = join(dir, 'duties.yaml');
  if (!existsSync(path)) return [];

  try {
    const raw = parseYaml(readFileSync(path, 'utf-8')) as { duties: DutyConfig[] };
    return (raw.duties ?? []).filter(d => d.id && d.role && d.prompt);
  } catch (err) {
    console.error(chalk.red(`[duties] Failed to load duties.yaml: ${(err as Error).message}`));
    return [];
  }
}

function parseCronInterval(cron: string): number {
  const match = cron.match(/^(\d+)(m|h|d)$/);
  if (!match) return 0;
  const [, num, unit] = match;
  const multiplier = unit === 'm' ? 60_000 : unit === 'h' ? 3600_000 : 86400_000;
  return Number(num) * multiplier;
}

function renderPrompt(template: string, vars: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
  }
  return result;
}

// --- Execution ---

function executeDuty(duty: DutyConfig, vars: Record<string, string> = {}): void {
  if (!hasDutyCapacity(duty.role)) {
    console.log(chalk.dim(`[duties] ${duty.id}: ${duty.role} duty slots full, skipping`));
    return;
  }

  const timestamp = new Date().toISOString().split('T')[0];
  const issueKey = `${duty.issuePrefix}-${timestamp}`;
  const prompt = renderPrompt(duty.prompt, { timestamp, ...vars });

  console.log(chalk.magenta(`[duties] Executing: ${duty.id} → ${duty.role}`));

  resolveSession({
    role: duty.role,
    issueKey,
    prompt,
    priority: 4,
    isDuty: true,  // uses separate duty capacity pool
  });
}

// --- Registration ---

export function registerDutyHandlers(): void {
  duties = loadDuties();
  if (duties.length === 0) {
    console.log(chalk.dim('[duties] No duties configured'));
    return;
  }

  console.log(chalk.magenta(`[duties] Loaded ${duties.length} standing duties`));

  // --- Cron-based duties: check on each tick ---
  const cronDuties = duties.filter(d => d.trigger.cron);
  for (const duty of cronDuties) {
    const intervalMs = parseCronInterval(duty.trigger.cron!);
    if (intervalMs === 0) {
      console.error(chalk.red(`[duties] Invalid cron: ${duty.trigger.cron} for ${duty.id}`));
      continue;
    }
    dutyStates.set(duty.id, { lastRun: 0, intervalMs });
  }

  bus.on('system:tick', async ({ timestamp }) => {
    for (const duty of cronDuties) {
      const state = dutyStates.get(duty.id);
      if (!state) continue;
      if (timestamp - state.lastRun >= state.intervalMs) {
        state.lastRun = timestamp;
        executeDuty(duty);
      }
    }
  });

  // --- Event-based duties: subscribe to bus events ---
  const eventDuties = duties.filter(d => d.trigger.event);
  for (const duty of eventDuties) {
    const eventName = duty.trigger.event!;

    if (eventName === 'agent:failed') {
      bus.on('agent:failed', ({ role, issueKey, error }) => {
        executeDuty(duty, { role, issueKey, error });
      });
    } else if (eventName === 'agent:completed') {
      bus.on('agent:completed', ({ role, issueKey }) => {
        executeDuty(duty, { role, issueKey, error: '' });
      });
    } else if (eventName === 'agent:idle') {
      bus.on('agent:idle', ({ role, issueKey }) => {
        executeDuty(duty, { role, issueKey, error: '' });
      });
    }
    // Extensible: add more event types as needed
  }
}

export function _resetDuties(): void {
  dutyStates.clear();
  duties = [];
}
