/**
 * Functional 3 — /pulse dashboard backend tests.
 * Covers objectives + decisions CRUD, daily briefing generation,
 * kill-switch persistence, and persona-tuner real analysis.
 */

import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmpDir = mkdtempSync(join(tmpdir(), 'anc-pulse-test-'));
process.env.ANC_DB_PATH = join(tmpDir, 'state.db');
process.env.ANC_KILL_SWITCH_PATH = join(tmpDir, 'kill-switch');
process.env.ANC_BUDGET_DISABLED = '1';

// Mock runtime so kill-switch.pauseAll() doesn't try to talk to tmux
vi.mock('../src/runtime/health.js', () => ({
  getTrackedSessions: vi.fn(() => []),
}));
vi.mock('../src/runtime/runner.js', () => ({
  suspendSession: vi.fn(() => true),
}));

const { _resetDb, getDb } = await import('../src/core/db.js');
const objectivesMod = await import('../src/core/objectives.js');
const decisionsMod = await import('../src/core/decisions.js');
const briefingMod = await import('../src/core/briefing.js');
const killSwitchMod = await import('../src/core/kill-switch.js');
const personaTunerMod = await import('../src/core/persona-tuner.js');
const { createTask } = await import('../src/core/tasks.js');

beforeEach(() => {
  _resetDb();
  for (const suffix of ['', '-wal', '-shm']) {
    try { rmSync(process.env.ANC_DB_PATH! + suffix, { force: true }); } catch { /**/ }
  }
  try { rmSync(process.env.ANC_KILL_SWITCH_PATH!, { force: true }); } catch { /**/ }
  killSwitchMod._resetKillSwitchCache();
  briefingMod._resetBriefingCache();
  objectivesMod._resetObjectivesInit();
  decisionsMod._resetDecisionsInit();
  getDb();
  objectivesMod.init();
  decisionsMod.init();
});

afterAll(() => {
  _resetDb();
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /**/ }
});

// ----------------------------------------------------------------------------

describe('objectives CRUD', () => {
  it('round-trips an objective with key results', () => {
    const obj = objectivesMod.createObjective({
      title: 'Ship pulse dashboard',
      description: 'End-to-end pulse',
      quarter: '2026 Q2',
    });
    expect(obj.id).toBeTruthy();
    expect(obj.title).toBe('Ship pulse dashboard');
    expect(obj.keyResults).toEqual([]);

    const kr = objectivesMod.addKeyResult(obj.id, {
      title: 'Reach 100 daily briefings',
      metric: 'briefings',
      target: 100,
    });
    expect(kr.objectiveId).toBe(obj.id);
    expect(kr.current).toBe(0);

    const updated = objectivesMod.updateKeyResult(kr.id, { current: 42 });
    expect(updated?.current).toBe(42);

    const list = objectivesMod.listObjectives('2026 Q2');
    expect(list).toHaveLength(1);
    expect(list[0].keyResults).toHaveLength(1);
    expect(list[0].keyResults[0].current).toBe(42);
  });

  it('filters by quarter', () => {
    objectivesMod.createObjective({ title: 'A', quarter: '2026 Q1' });
    objectivesMod.createObjective({ title: 'B', quarter: '2026 Q2' });
    expect(objectivesMod.listObjectives('2026 Q1')).toHaveLength(1);
    expect(objectivesMod.listObjectives('2026 Q2')).toHaveLength(1);
    expect(objectivesMod.listObjectives()).toHaveLength(2);
  });
});

// ----------------------------------------------------------------------------

describe('decisions CRUD', () => {
  it('round-trips a decision', () => {
    const d = decisionsMod.createDecision({
      title: 'Use SQLite',
      rationale: 'Single-node, embedded, simple.',
      decidedBy: 'ceo',
      tags: ['arch', 'db'],
    });
    expect(d.id).toBeTruthy();
    expect(d.tags).toEqual(['arch', 'db']);

    const list = decisionsMod.listDecisions({ limit: 10 });
    expect(list).toHaveLength(1);
    expect(list[0].title).toBe('Use SQLite');
    expect(list[0].tags).toEqual(['arch', 'db']);
  });
});

// ----------------------------------------------------------------------------

describe('daily briefing', () => {
  it('reflects yesterday completions, today queue, and risks', () => {
    const dayMs = 24 * 60 * 60 * 1000;
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const yesterdayMs = startOfToday.getTime() - dayMs / 2;

    // Yesterday: a completed task with a handoff summary
    createTask({
      title: 'Finished briefing generator',
      state: 'done',
      completedAt: yesterdayMs,
      handoffSummary: 'Wired briefing.ts into routes.ts and tested.',
    });

    // Today queue: pending tasks
    createTask({ title: 'Queue item one', state: 'todo', priority: 1 });
    createTask({ title: 'Queue item two', state: 'todo', priority: 2 });

    // Risk: failed task in last 24h
    createTask({
      title: 'Crashed deploy',
      state: 'failed',
      completedAt: Date.now() - 1000 * 60 * 60,
    });

    briefingMod._resetBriefingCache();
    const b = briefingMod.generateBriefing();

    expect(b.generatedAt).toBeGreaterThan(0);
    expect(b.yesterdayCompletions).toContain('Finished briefing generator');
    expect(b.todayQueue).toContain('Queue item one');
    expect(b.todayQueue).toContain('Queue item two');
    // priority ASC means lower priority number first
    expect(b.todayQueue[0]).toBe('Queue item one');
    expect(b.wins.some((w) => w.includes('Wired briefing.ts'))).toBe(true);
    expect(b.risks.some((r) => r.includes('Crashed deploy'))).toBe(true);
    expect(b.costBurn.budgetUsd).toBeGreaterThanOrEqual(0);
  });

  it('caches the result for one hour', () => {
    briefingMod._resetBriefingCache();
    const a = briefingMod.generateBriefing();
    const b = briefingMod.generateBriefing();
    expect(a.generatedAt).toBe(b.generatedAt);
  });
});

// ----------------------------------------------------------------------------

describe('kill switch', () => {
  it('persists the paused flag via the flag file', () => {
    expect(killSwitchMod.isGlobalPaused()).toBe(false);

    const r1 = killSwitchMod.pauseAll();
    expect(r1.ok).toBe(true);
    expect(existsSync(process.env.ANC_KILL_SWITCH_PATH!)).toBe(true);

    killSwitchMod._resetKillSwitchCache();
    expect(killSwitchMod.isGlobalPaused()).toBe(true);

    const r2 = killSwitchMod.resume();
    expect(r2.wasPaused).toBe(true);
    expect(existsSync(process.env.ANC_KILL_SWITCH_PATH!)).toBe(false);

    killSwitchMod._resetKillSwitchCache();
    expect(killSwitchMod.isGlobalPaused()).toBe(false);
  });
});

// ----------------------------------------------------------------------------

describe('persona tuner', () => {
  it('returns suggestions for the current persona set', async () => {
    const suggestions = await personaTunerMod.analyzeScopes();
    expect(Array.isArray(suggestions)).toBe(true);
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions.length).toBeLessThanOrEqual(10);
    for (const s of suggestions) {
      expect(['overlap', 'gap', 'health']).toContain(s.kind);
      expect(typeof s.severity).toBe('number');
      expect(typeof s.title).toBe('string');
    }
    // Sorted by severity desc
    for (let i = 1; i < suggestions.length; i++) {
      expect(suggestions[i - 1].severity).toBeGreaterThanOrEqual(suggestions[i].severity);
    }
  });
});
