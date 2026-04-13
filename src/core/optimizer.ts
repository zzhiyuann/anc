/**
 * Self-optimization engine — autoresearch-style ratchet for ANC.
 *
 * Computes metrics, proposes rule-based experiments, applies them,
 * measures outcomes, and accepts/rejects based on a 2% improvement threshold.
 *
 * Phase D v1: deterministic rules, no LLM calls.
 */

import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { getDb } from './db.js';
import { computeSystemMetrics, type SystemMetrics } from './metrics.js';
import { createLogger } from './logger.js';

const log = createLogger('optimizer');

// --- Types ---

export type ExperimentTarget = 'persona' | 'routing' | 'model' | 'memory' | 'review';
export type ExperimentMetric = 'quality_score' | 'success_rate' | 'cost_per_task' | 'completion_time';
export type ExperimentStatus = 'proposed' | 'running' | 'measured' | 'accepted' | 'rejected';

export interface OptimizationExperiment {
  id: string;
  target: ExperimentTarget;
  hypothesis: string;
  change: { file?: string; field?: string; before: string; after: string };
  metric: ExperimentMetric;
  baselineValue: number;
  experimentValue?: number;
  status: ExperimentStatus;
  createdAt: number;
  measuredAt?: number;
}

export interface OptimizationResult {
  experimentId: string;
  improvement: number; // percentage change (positive = better)
  accepted: boolean;
  reason: string;
}

/** Minimum improvement (%) to accept an experiment. */
const RATCHET_THRESHOLD = 2;

/** Minimum number of tasks in measurement window before we evaluate. */
const MIN_TASKS_FOR_MEASUREMENT = 5;

// --- Database operations ---

export function ensureExperimentsTable(): void {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS optimization_experiments (
      id TEXT PRIMARY KEY,
      target TEXT NOT NULL,
      hypothesis TEXT NOT NULL,
      change_json TEXT NOT NULL,
      metric TEXT NOT NULL,
      baseline_value REAL NOT NULL,
      experiment_value REAL,
      status TEXT NOT NULL DEFAULT 'proposed',
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      measured_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_opt_exp_status ON optimization_experiments(status);
  `);
}

function rowToExperiment(r: Record<string, unknown>): OptimizationExperiment {
  const change = JSON.parse(r.change_json as string);
  return {
    id: r.id as string,
    target: r.target as ExperimentTarget,
    hypothesis: r.hypothesis as string,
    change,
    metric: r.metric as ExperimentMetric,
    baselineValue: r.baseline_value as number,
    experimentValue: r.experiment_value as number | undefined,
    status: r.status as ExperimentStatus,
    createdAt: r.created_at as number,
    measuredAt: r.measured_at as number | undefined,
  };
}

export function listExperiments(status?: ExperimentStatus): OptimizationExperiment[] {
  const db = getDb();
  if (status) {
    const rows = db.prepare(
      'SELECT * FROM optimization_experiments WHERE status = ? ORDER BY created_at DESC'
    ).all(status) as Array<Record<string, unknown>>;
    return rows.map(rowToExperiment);
  }
  const rows = db.prepare(
    'SELECT * FROM optimization_experiments ORDER BY created_at DESC'
  ).all() as Array<Record<string, unknown>>;
  return rows.map(rowToExperiment);
}

export function getExperiment(id: string): OptimizationExperiment | null {
  const row = getDb().prepare(
    'SELECT * FROM optimization_experiments WHERE id = ?'
  ).get(id) as Record<string, unknown> | undefined;
  return row ? rowToExperiment(row) : null;
}

function saveExperiment(exp: OptimizationExperiment): void {
  getDb().prepare(`
    INSERT OR REPLACE INTO optimization_experiments
    (id, target, hypothesis, change_json, metric, baseline_value, experiment_value, status, created_at, measured_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    exp.id, exp.target, exp.hypothesis, JSON.stringify(exp.change),
    exp.metric, exp.baselineValue, exp.experimentValue ?? null,
    exp.status, exp.createdAt, exp.measuredAt ?? null,
  );
}

// --- Metrics helpers ---

/** Extract the specific metric value from SystemMetrics. */
function extractMetricValue(metrics: SystemMetrics, metric: ExperimentMetric): number {
  switch (metric) {
    case 'quality_score': return metrics.quality.avgScore;
    case 'success_rate': {
      const { done, total } = metrics.tasks;
      return total > 0 ? (done / total) * 100 : 0;
    }
    case 'cost_per_task': return metrics.cost.avgPerTask;
    case 'completion_time': return metrics.tasks.avgCompletionMs;
  }
}

/** For cost and time, lower is better. For quality and success, higher is better. */
function isLowerBetter(metric: ExperimentMetric): boolean {
  return metric === 'cost_per_task' || metric === 'completion_time';
}

/** Calculate improvement percentage (positive = better). */
function calcImprovement(baseline: number, experiment: number, metric: ExperimentMetric): number {
  if (baseline === 0) return 0;
  if (isLowerBetter(metric)) {
    // Lower is better: improvement = (baseline - experiment) / baseline * 100
    return ((baseline - experiment) / baseline) * 100;
  }
  // Higher is better: improvement = (experiment - baseline) / baseline * 100
  return ((experiment - baseline) / baseline) * 100;
}

// --- Core optimizer functions ---

/**
 * Compute aggregated metrics over a window.
 * Delegates to the metrics module.
 */
export function computeMetrics(windowDays = 7): SystemMetrics {
  return computeSystemMetrics(windowDays);
}

/**
 * Propose ONE experiment based on current metrics.
 * Deterministic rule-based logic (v1 — no LLM).
 *
 * Priority order:
 *  1. Quality score < 60 avg → persona enhancement
 *  2. Success rate < 80% for any role → routing rule change
 *  3. Cost per task > $2 avg → model downgrade for low priority
 *  4. Completion time > 30min avg → decomposition threshold
 */
export function proposeExperiment(metrics: SystemMetrics): OptimizationExperiment | null {
  // Don't propose if there's already a running experiment
  const running = listExperiments('running');
  if (running.length > 0) {
    log.debug(`Skipping proposal — ${running.length} experiment(s) already running`);
    return null;
  }

  const id = `exp-${randomUUID().slice(0, 8)}`;
  const now = Date.now();

  // Rule 1: Low quality score → enhance persona verification instructions
  if (metrics.quality.avgScore > 0 && metrics.quality.avgScore < 60) {
    return {
      id,
      target: 'persona',
      hypothesis: `Quality score avg (${metrics.quality.avgScore.toFixed(1)}) is below 60. Adding explicit verification step to base persona should improve task quality.`,
      change: {
        file: 'personas/base.md',
        field: 'verification_instructions',
        before: '',
        after: '## Verification\nBefore completing any task, verify your output against the original requirements. Check edge cases and test manually.',
      },
      metric: 'quality_score',
      baselineValue: metrics.quality.avgScore,
      status: 'proposed',
      createdAt: now,
    };
  }

  // Rule 2: Low success rate for a specific role → routing adjustment
  for (const [role, rate] of Object.entries(metrics.agents.successRate)) {
    if (rate < 80 && rate > 0) {
      return {
        id,
        target: 'routing',
        hypothesis: `Role "${role}" has ${rate.toFixed(1)}% success rate (below 80%). Routing fewer complex tasks to this role should improve overall success.`,
        change: {
          file: 'config/routing.yaml',
          field: `success_threshold.${role}`,
          before: 'default',
          after: 'restricted',
        },
        metric: 'success_rate',
        baselineValue: rate,
        status: 'proposed',
        createdAt: now,
      };
    }
  }

  // Rule 3: High cost per task → propose model downgrade for low-priority tasks
  if (metrics.cost.avgPerTask > 2) {
    return {
      id,
      target: 'model',
      hypothesis: `Average cost per task ($${metrics.cost.avgPerTask.toFixed(2)}) exceeds $2. Using sonnet tier for low-priority tasks should reduce cost.`,
      change: {
        file: 'config/agents.yaml',
        field: 'low_priority_model_tier',
        before: 'opus',
        after: 'sonnet',
      },
      metric: 'cost_per_task',
      baselineValue: metrics.cost.avgPerTask,
      status: 'proposed',
      createdAt: now,
    };
  }

  // Rule 4: Slow completion → suggest decomposition threshold change
  const avgMinutes = metrics.tasks.avgCompletionMs / (60 * 1000);
  if (avgMinutes > 30) {
    return {
      id,
      target: 'review',
      hypothesis: `Average completion time (${avgMinutes.toFixed(1)} min) exceeds 30 min. Lowering auto-decomposition threshold should speed up tasks.`,
      change: {
        file: 'config/review.yaml',
        field: 'decomposition_threshold',
        before: 'high',
        after: 'medium',
      },
      metric: 'completion_time',
      baselineValue: metrics.tasks.avgCompletionMs,
      status: 'proposed',
      createdAt: now,
    };
  }

  log.info('All metrics within acceptable ranges — no experiment proposed');
  return null;
}

/**
 * Apply an experiment's change to the system configuration.
 * Writes to the target file (persona, routing, agents, review config).
 */
export function applyExperiment(exp: OptimizationExperiment): void {
  if (exp.status !== 'proposed') {
    throw new Error(`Cannot apply experiment ${exp.id} in status ${exp.status}`);
  }

  const configRoot = process.cwd();

  switch (exp.target) {
    case 'persona': {
      // Append verification instructions to persona file
      const filePath = join(configRoot, exp.change.file ?? 'personas/base.md');
      if (existsSync(filePath)) {
        const content = readFileSync(filePath, 'utf-8');
        if (!content.includes(exp.change.after)) {
          writeFileSync(filePath, content + '\n\n' + exp.change.after, 'utf-8');
        }
      }
      break;
    }
    case 'model': {
      // Update agents.yaml with model tier override
      const filePath = join(configRoot, exp.change.file ?? 'config/agents.yaml');
      if (existsSync(filePath)) {
        const raw = readFileSync(filePath, 'utf-8');
        const config = parseYaml(raw) as Record<string, unknown>;
        // Store the model tier change as metadata; actual routing uses the config
        (config as Record<string, unknown>)['_optimizer_model_override'] = {
          tier: exp.change.after,
          experiment: exp.id,
        };
        writeFileSync(filePath, stringifyYaml(config), 'utf-8');
      }
      break;
    }
    case 'routing':
    case 'review': {
      // For v1, we log the proposed change but don't modify routing/review YAML directly.
      // These require CEO approval in production. The experiment is tracked for measurement.
      log.info(`Experiment ${exp.id}: proposed ${exp.target} change — ${exp.change.field}: ${exp.change.before} → ${exp.change.after}`);
      break;
    }
    default:
      log.warn(`Unknown experiment target: ${exp.target}`);
  }

  exp.status = 'running';
  saveExperiment(exp);
  log.info(`Experiment ${exp.id} applied and now running`);
}

/**
 * Measure the outcome of a running experiment by comparing current metrics
 * to the baseline. Requires at least MIN_TASKS_FOR_MEASUREMENT tasks.
 */
export function measureExperiment(
  exp: OptimizationExperiment,
  windowDays = 3,
): OptimizationResult | null {
  if (exp.status !== 'running') {
    throw new Error(`Cannot measure experiment ${exp.id} in status ${exp.status}`);
  }

  const metrics = computeSystemMetrics(windowDays);

  // Need minimum tasks for a meaningful measurement
  if (metrics.tasks.total < MIN_TASKS_FOR_MEASUREMENT) {
    log.info(`Experiment ${exp.id}: only ${metrics.tasks.total} tasks (need ${MIN_TASKS_FOR_MEASUREMENT}), skipping measurement`);
    return null;
  }

  const experimentValue = extractMetricValue(metrics, exp.metric);
  const improvement = calcImprovement(exp.baselineValue, experimentValue, exp.metric);
  const accepted = improvement >= RATCHET_THRESHOLD;

  exp.experimentValue = experimentValue;
  exp.measuredAt = Date.now();
  exp.status = 'measured';
  saveExperiment(exp);

  const reason = accepted
    ? `Improvement of ${improvement.toFixed(1)}% (>= ${RATCHET_THRESHOLD}% threshold)`
    : improvement > 0
      ? `Improvement of ${improvement.toFixed(1)}% below ${RATCHET_THRESHOLD}% threshold`
      : `No improvement (${improvement.toFixed(1)}%)`;

  return { experimentId: exp.id, improvement, accepted, reason };
}

/**
 * Rollback a rejected experiment's change.
 */
export function rollbackExperiment(exp: OptimizationExperiment): void {
  const configRoot = process.cwd();

  switch (exp.target) {
    case 'persona': {
      const filePath = join(configRoot, exp.change.file ?? 'personas/base.md');
      if (existsSync(filePath)) {
        const content = readFileSync(filePath, 'utf-8');
        const cleaned = content.replace('\n\n' + exp.change.after, '');
        writeFileSync(filePath, cleaned, 'utf-8');
      }
      break;
    }
    case 'model': {
      const filePath = join(configRoot, exp.change.file ?? 'config/agents.yaml');
      if (existsSync(filePath)) {
        const raw = readFileSync(filePath, 'utf-8');
        const config = parseYaml(raw) as Record<string, unknown>;
        delete config['_optimizer_model_override'];
        writeFileSync(filePath, stringifyYaml(config), 'utf-8');
      }
      break;
    }
    case 'routing':
    case 'review':
      // These weren't applied in v1 (CEO approval required), nothing to rollback
      break;
  }

  exp.status = 'rejected';
  saveExperiment(exp);
  log.info(`Experiment ${exp.id} rolled back and rejected`);
}

/**
 * Accept a measured experiment — mark as accepted, keep the change.
 */
export function acceptExperiment(exp: OptimizationExperiment): void {
  exp.status = 'accepted';
  saveExperiment(exp);
  log.info(`Experiment ${exp.id} accepted (improvement preserved)`);
}

/**
 * Run one full optimization cycle:
 *  1. Compute current metrics
 *  2. Check any running experiments for measurement
 *  3. Propose a new experiment if none running
 *  4. Apply the proposed experiment
 *
 * Returns a summary of actions taken.
 */
export function runOptimizationCycle(opts: { dryRun?: boolean } = {}): {
  metrics: SystemMetrics;
  measured?: OptimizationResult;
  proposed?: OptimizationExperiment;
  applied: boolean;
} {
  ensureExperimentsTable();

  // Step 1: Compute current metrics
  const metrics = computeMetrics(7);
  log.info(`Metrics: ${metrics.tasks.total} tasks, quality=${metrics.quality.avgScore.toFixed(1)}, cost=$${metrics.cost.avgPerTask.toFixed(2)}`);

  // Step 2: Check running experiments
  let measured: OptimizationResult | undefined;
  const running = listExperiments('running');
  if (running.length > 0) {
    const exp = running[0];
    const result = measureExperiment(exp, 3);
    if (result) {
      measured = result;
      if (result.accepted) {
        if (!opts.dryRun) acceptExperiment(exp);
        log.info(`Experiment ${exp.id} accepted: ${result.reason}`);
      } else {
        if (!opts.dryRun) rollbackExperiment(exp);
        log.info(`Experiment ${exp.id} rejected: ${result.reason}`);
      }
    } else {
      // Not enough data yet — keep running
      return { metrics, applied: false };
    }
  }

  // Step 3: Propose new experiment
  const proposed = proposeExperiment(metrics);
  if (!proposed) {
    return { metrics, measured, applied: false };
  }

  // Step 4: Apply if not dry run
  if (!opts.dryRun) {
    saveExperiment(proposed);
    applyExperiment(proposed);
  }

  return { metrics, measured, proposed, applied: !opts.dryRun };
}
