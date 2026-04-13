/**
 * Phase D — Self-optimization engine tests.
 * Tests metrics computation, experiment proposal, apply/measure/rollback cycle.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { _setDbForTesting, getDb } from '../src/core/db.js';
import { setFileLogging } from '../src/core/logger.js';
import { computeSystemMetrics } from '../src/core/metrics.js';
import {
  ensureExperimentsTable,
  proposeExperiment,
  listExperiments,
  getExperiment,
  runOptimizationCycle,
  type OptimizationExperiment,
} from '../src/core/optimizer.js';

setFileLogging(false);

function freshDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');

  // Create minimal schema for testing
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      title TEXT NOT NULL,
      description TEXT,
      state TEXT NOT NULL DEFAULT 'todo',
      priority INTEGER NOT NULL DEFAULT 3,
      source TEXT NOT NULL DEFAULT 'dashboard',
      parent_task_id TEXT,
      created_by TEXT NOT NULL DEFAULT 'ceo',
      linear_issue_key TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      completed_at INTEGER,
      handoff_summary TEXT,
      assignee TEXT,
      due_date TEXT,
      progress INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS budget_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_role TEXT NOT NULL,
      issue_key TEXT NOT NULL,
      tokens INTEGER NOT NULL DEFAULT 0,
      cost_usd REAL NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    CREATE TABLE IF NOT EXISTS task_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      role TEXT,
      type TEXT NOT NULL,
      payload TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

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

  return db;
}

describe('metrics', () => {
  beforeEach(() => {
    _setDbForTesting(freshDb());
  });

  it('returns zero metrics for empty database', () => {
    const metrics = computeSystemMetrics(7);
    expect(metrics.tasks.total).toBe(0);
    expect(metrics.tasks.done).toBe(0);
    expect(metrics.quality.avgScore).toBe(0);
    expect(metrics.cost.totalUsd).toBe(0);
  });

  it('counts tasks by state', () => {
    const db = getDb();
    const now = Date.now();
    db.prepare('INSERT INTO tasks (id, title, state, created_at) VALUES (?, ?, ?, ?)').run('t1', 'Task 1', 'done', now);
    db.prepare('INSERT INTO tasks (id, title, state, created_at, completed_at) VALUES (?, ?, ?, ?, ?)').run('t2', 'Task 2', 'done', now, now + 10000);
    db.prepare('INSERT INTO tasks (id, title, state, created_at) VALUES (?, ?, ?, ?)').run('t3', 'Task 3', 'failed', now);
    db.prepare('INSERT INTO tasks (id, title, state, created_at) VALUES (?, ?, ?, ?)').run('t4', 'Task 4', 'todo', now);

    const metrics = computeSystemMetrics(7);
    expect(metrics.tasks.total).toBe(4);
    expect(metrics.tasks.done).toBe(2);
    expect(metrics.tasks.failed).toBe(1);
  });

  it('aggregates quality scores from task_events', () => {
    const db = getDb();
    const now = Date.now();
    db.prepare('INSERT INTO tasks (id, title, state, created_at) VALUES (?, ?, ?, ?)').run('t1', 'Task 1', 'done', now);
    db.prepare('INSERT INTO tasks (id, title, state, created_at) VALUES (?, ?, ?, ?)').run('t2', 'Task 2', 'done', now);

    db.prepare('INSERT INTO task_events (task_id, type, payload, created_at) VALUES (?, ?, ?, ?)').run('t1', 'task:quality-score', JSON.stringify({ score: 80 }), now);
    db.prepare('INSERT INTO task_events (task_id, type, payload, created_at) VALUES (?, ?, ?, ?)').run('t2', 'task:quality-score', JSON.stringify({ score: 40 }), now);

    const metrics = computeSystemMetrics(7);
    expect(metrics.quality.avgScore).toBe(60);
    expect(metrics.quality.minScore).toBe(40);
    expect(metrics.quality.maxScore).toBe(80);
    expect(metrics.quality.belowThreshold).toBe(1); // score 40 < 60
  });

  it('aggregates cost from budget_log', () => {
    const db = getDb();
    const now = Date.now();
    db.prepare('INSERT INTO budget_log (agent_role, issue_key, cost_usd, created_at) VALUES (?, ?, ?, ?)').run('engineer', 'T-1', 1.5, now);
    db.prepare('INSERT INTO budget_log (agent_role, issue_key, cost_usd, created_at) VALUES (?, ?, ?, ?)').run('ops', 'T-2', 0.5, now);

    // Need tasks for avg per task
    db.prepare('INSERT INTO tasks (id, title, state, created_at) VALUES (?, ?, ?, ?)').run('t1', 'Task', 'done', now);

    const metrics = computeSystemMetrics(7);
    expect(metrics.cost.totalUsd).toBe(2);
    expect(metrics.cost.byRole['engineer']).toBe(1.5);
    expect(metrics.cost.byRole['ops']).toBe(0.5);
    expect(metrics.cost.avgPerTask).toBe(2); // 2 USD / 1 task
  });
});

describe('optimizer', () => {
  beforeEach(() => {
    _setDbForTesting(freshDb());
    ensureExperimentsTable();
  });

  it('proposes no experiment when metrics are healthy', () => {
    const db = getDb();
    const now = Date.now();
    // Create healthy tasks
    for (let i = 0; i < 10; i++) {
      db.prepare('INSERT INTO tasks (id, title, state, assignee, created_at, completed_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(`t${i}`, `Task ${i}`, 'done', 'engineer', now, now + 300_000); // 5 min avg
      db.prepare('INSERT INTO task_events (task_id, type, payload, created_at) VALUES (?, ?, ?, ?)')
        .run(`t${i}`, 'task:quality-score', JSON.stringify({ score: 85 }), now);
    }
    db.prepare('INSERT INTO budget_log (agent_role, issue_key, cost_usd, created_at) VALUES (?, ?, ?, ?)')
      .run('engineer', 'T-1', 0.5, now);

    const metrics = computeSystemMetrics(7);
    const exp = proposeExperiment(metrics);
    expect(exp).toBeNull();
  });

  it('proposes persona experiment when quality is low', () => {
    const db = getDb();
    const now = Date.now();
    db.prepare('INSERT INTO tasks (id, title, state, created_at) VALUES (?, ?, ?, ?)').run('t1', 'Task 1', 'done', now);
    db.prepare('INSERT INTO task_events (task_id, type, payload, created_at) VALUES (?, ?, ?, ?)').run('t1', 'task:quality-score', JSON.stringify({ score: 45 }), now);

    const metrics = computeSystemMetrics(7);
    const exp = proposeExperiment(metrics);
    expect(exp).not.toBeNull();
    expect(exp!.target).toBe('persona');
    expect(exp!.metric).toBe('quality_score');
  });

  it('proposes routing experiment when success rate is low', () => {
    const db = getDb();
    const now = Date.now();
    // Quality scores are fine (> 60)
    for (let i = 0; i < 5; i++) {
      const state = i < 2 ? 'done' : 'failed';
      db.prepare('INSERT INTO tasks (id, title, state, assignee, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(`t${i}`, `Task ${i}`, state, 'ops', now);
      db.prepare('INSERT INTO task_events (task_id, type, payload, created_at) VALUES (?, ?, ?, ?)')
        .run(`t${i}`, 'task:quality-score', JSON.stringify({ score: 75 }), now);
    }

    const metrics = computeSystemMetrics(7);
    const exp = proposeExperiment(metrics);
    expect(exp).not.toBeNull();
    expect(exp!.target).toBe('routing');
    expect(exp!.hypothesis).toContain('ops');
  });

  it('proposes model downgrade when cost is too high', () => {
    const db = getDb();
    const now = Date.now();
    // 1 task + $5 cost -> $5/task
    db.prepare('INSERT INTO tasks (id, title, state, assignee, created_at, completed_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run('t1', 'Task 1', 'done', 'engineer', now, now + 60000);
    db.prepare('INSERT INTO task_events (task_id, type, payload, created_at) VALUES (?, ?, ?, ?)')
      .run('t1', 'task:quality-score', JSON.stringify({ score: 90 }), now);
    db.prepare('INSERT INTO budget_log (agent_role, issue_key, cost_usd, created_at) VALUES (?, ?, ?, ?)')
      .run('engineer', 'T-1', 5, now);

    const metrics = computeSystemMetrics(7);
    // Agent has 100% success rate, quality > 60 — should hit cost rule
    const exp = proposeExperiment(metrics);
    expect(exp).not.toBeNull();
    expect(exp!.target).toBe('model');
    expect(exp!.metric).toBe('cost_per_task');
  });

  it('does not propose when an experiment is already running', () => {
    const db = getDb();
    const now = Date.now();
    db.prepare('INSERT INTO tasks (id, title, state, created_at) VALUES (?, ?, ?, ?)').run('t1', 'Task 1', 'done', now);
    db.prepare('INSERT INTO task_events (task_id, type, payload, created_at) VALUES (?, ?, ?, ?)').run('t1', 'task:quality-score', JSON.stringify({ score: 30 }), now);

    // Insert a running experiment
    db.prepare(`INSERT INTO optimization_experiments (id, target, hypothesis, change_json, metric, baseline_value, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run('exp-test', 'persona', 'Test', '{}', 'quality_score', 30, 'running', now);

    const metrics = computeSystemMetrics(7);
    const exp = proposeExperiment(metrics);
    expect(exp).toBeNull();
  });

  it('lists experiments with status filter', () => {
    const db = getDb();
    const now = Date.now();
    db.prepare(`INSERT INTO optimization_experiments (id, target, hypothesis, change_json, metric, baseline_value, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run('exp-1', 'persona', 'H1', '{}', 'quality_score', 50, 'accepted', now);
    db.prepare(`INSERT INTO optimization_experiments (id, target, hypothesis, change_json, metric, baseline_value, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run('exp-2', 'routing', 'H2', '{}', 'success_rate', 70, 'running', now);

    const all = listExperiments();
    expect(all).toHaveLength(2);

    const running = listExperiments('running');
    expect(running).toHaveLength(1);
    expect(running[0].id).toBe('exp-2');
  });

  it('runs a dry-run optimization cycle without persisting', () => {
    const db = getDb();
    const now = Date.now();
    db.prepare('INSERT INTO tasks (id, title, state, created_at) VALUES (?, ?, ?, ?)').run('t1', 'Task 1', 'done', now);
    db.prepare('INSERT INTO task_events (task_id, type, payload, created_at) VALUES (?, ?, ?, ?)').run('t1', 'task:quality-score', JSON.stringify({ score: 40 }), now);

    const result = runOptimizationCycle({ dryRun: true });
    expect(result.metrics.tasks.total).toBe(1);
    expect(result.proposed).not.toBeNull();
    expect(result.applied).toBe(false);

    // Verify nothing was persisted
    const experiments = listExperiments();
    expect(experiments).toHaveLength(0);
  });

  it('getExperiment returns null for non-existent id', () => {
    const exp = getExperiment('non-existent');
    expect(exp).toBeNull();
  });
});
