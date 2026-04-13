/**
 * Minor Gaps tests — BLOCKED.md, PROGRESS.md, budget toggle, crash recovery.
 */

import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmpDir = mkdtempSync(join(tmpdir(), 'anc-minor-gaps-'));
process.env.ANC_DB_PATH = join(tmpDir, 'state.db');
process.env.ANC_BUDGET_DISABLED = '1';
process.env.ANC_STATE_DIR = join(tmpDir, 'anc-state');

// Create workspace directories for test issues
const workspaceBase = join(tmpDir, 'workspaces');
mkdirSync(workspaceBase, { recursive: true });

vi.mock('../src/runtime/health.js', () => ({
  getTrackedSessions: vi.fn(() => []),
  getHealthStatus: vi.fn(() => ({})),
  hasCapacity: vi.fn(() => true),
  markIdle: vi.fn(() => true),
  markSuspended: vi.fn(() => true),
  untrackSession: vi.fn(),
  getSessionForIssue: vi.fn(),
}));
vi.mock('../src/runtime/runner.js', () => ({
  sendToAgent: vi.fn(() => true),
  captureOutput: vi.fn(() => ''),
  killAgent: vi.fn(),
  sessionExists: vi.fn(() => false),
  resolveSession: vi.fn(),
}));
vi.mock('../src/runtime/resolve.js', () => ({
  resolveSession: vi.fn(() => ({ action: 'spawned', tmuxSession: 'test' })),
}));
vi.mock('../src/runtime/workspace.js', () => ({
  getWorkspacePath: vi.fn((issueKey: string) => join(workspaceBase, issueKey)),
}));
vi.mock('../src/linear/client.js', () => ({
  addComment: vi.fn(async () => {}),
  getIssue: vi.fn(async () => null),
  setIssueStatus: vi.fn(async () => true),
  createSubIssue: vi.fn(async () => null),
}));

const { _resetDb, getDb } = await import('../src/core/db.js');
const budgetMod = await import('../src/core/budget.js');
const notifMod = await import('../src/core/notifications.js');
const tasksMod = await import('../src/core/tasks.js');

function resetAll() {
  _resetDb();
  for (const suffix of ['', '-wal', '-shm']) {
    try { rmSync(process.env.ANC_DB_PATH! + suffix, { force: true }); } catch { /**/ }
  }
  getDb();
}

beforeEach(() => resetAll());

afterAll(() => {
  _resetDb();
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /**/ }
});

// === Task 1: BLOCKED.md detection creates notification ===

describe('BLOCKED.md detection', () => {
  it('createNotification with kind=alert on blocked', () => {
    // Verify notification creation works with the expected shape
    const notif = notifMod.createNotification({
      kind: 'alert',
      severity: 'warning',
      title: 'Agent blocked: TEST-1',
      body: 'Missing API key',
      agentRole: 'engineer',
    });
    expect(notif.kind).toBe('alert');
    expect(notif.severity).toBe('warning');
    expect(notif.title).toContain('blocked');
    expect(notif.body).toBe('Missing API key');
  });

  it('sets task state to suspended when blocked', () => {
    const task = tasksMod.createTask({ title: 'Blocked task' });
    tasksMod.setTaskState(task.id, 'suspended');
    const updated = tasksMod.getTask(task.id);
    expect(updated?.state).toBe('suspended');
  });
});

// === Task 2: PROGRESS.md updates handoffSummary ===

describe('PROGRESS.md detection', () => {
  it('updateTask sets handoffSummary', () => {
    const task = tasksMod.createTask({ title: 'Progress task' });
    tasksMod.updateTask(task.id, { handoffSummary: 'Step 3/5 complete' });
    const updated = tasksMod.getTask(task.id);
    expect(updated?.handoffSummary).toBe('Step 3/5 complete');
  });
});

// === Task 3: Budget toggle-unlimited ===

describe('Budget toggle-unlimited', () => {
  it('setDisabled toggles the env var', () => {
    budgetMod.setDisabled(true);
    expect(budgetMod.isDisabled()).toBe(true);

    budgetMod.setDisabled(false);
    expect(budgetMod.isDisabled()).toBe(false);
  });

  it('toggling back preserves config', () => {
    budgetMod.setDisabled(true);
    const cfg = budgetMod.getConfig();
    expect(cfg.daily.limit).toBeGreaterThan(0); // config still intact

    budgetMod.setDisabled(false);
    const cfg2 = budgetMod.getConfig();
    expect(cfg2.daily.limit).toBe(cfg.daily.limit);
  });
});

// === Task 4: Agent crash recovery creates failure notification ===

describe('Agent crash recovery', () => {
  it('createNotification with kind=failure on crash', () => {
    const notif = notifMod.createNotification({
      kind: 'failure',
      severity: 'critical',
      title: 'Agent crashed: TEST-2',
      body: 'engineer session died unexpectedly after 120s',
      agentRole: 'engineer',
    });
    expect(notif.kind).toBe('failure');
    expect(notif.severity).toBe('critical');
    expect(notif.title).toContain('crashed');
  });

  it('sets task state to failed on crash', () => {
    const task = tasksMod.createTask({ title: 'Crashed task' });
    tasksMod.setTaskState(task.id, 'failed', Date.now());
    const updated = tasksMod.getTask(task.id);
    expect(updated?.state).toBe('failed');
    expect(updated?.completedAt).toBeGreaterThan(0);
  });

  it('adds crash comment to task', () => {
    const task = tasksMod.createTask({ title: 'Crash comment test' });
    const commentId = tasksMod.addTaskComment(
      task.id,
      'agent:engineer',
      'Session crashed unexpectedly. Manual intervention may be needed.',
    );
    expect(commentId).not.toBeNull();
  });
});
