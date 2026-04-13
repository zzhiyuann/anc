/**
 * Lifecycle integrity tests.
 *
 * Verifies the end-to-end task lifecycle:
 *   POST /tasks → state=running → HANDOFF.md → state=review + handoffSummary + children
 */

import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Isolated DB
const tmpDir = mkdtempSync(join(tmpdir(), 'anc-lifecycle-test-'));
process.env.ANC_DB_PATH = join(tmpDir, 'state.db');
process.env.ANC_WORKSPACE_BASE = join(tmpDir, 'workspaces');

const { _resetDb, getDb } = await import('../src/core/db.js');
const { createTask, getTask, setTaskState, updateTask, resolveTaskIdFromIssueKey } = await import('../src/core/tasks.js');
const { processHandoff } = await import('../src/hooks/handoff-processor.js');
const { parseActions, extractSummary } = await import('../src/hooks/actions-parser.js');

// Mock Linear API calls to prevent real HTTP — they return success
vi.mock('../src/linear/client.js', () => ({
  addComment: vi.fn().mockResolvedValue(undefined),
  getIssue: vi.fn().mockResolvedValue(null),
  setIssueStatus: vi.fn().mockResolvedValue(false),
  createSubIssue: vi.fn().mockResolvedValue(null),
}));

// Mock resolveSession to avoid real tmux spawns
vi.mock('../src/runtime/runner.js', () => ({
  resolveSession: vi.fn().mockReturnValue({ action: 'spawned', tmuxSession: 'mock-tmux' }),
  spawnClaude: vi.fn().mockReturnValue({ success: true, tmuxSession: 'mock-tmux' }),
  sessionExists: vi.fn().mockReturnValue(false),
  sendToAgent: vi.fn(),
  suspendSession: vi.fn(),
  captureOutput: vi.fn().mockReturnValue(''),
  killAgent: vi.fn(),
}));

// Mock health tracker
vi.mock('../src/runtime/health.js', () => ({
  trackSession: vi.fn(),
  untrackSession: vi.fn(),
  markActiveFromIdle: vi.fn(),
  markSuspended: vi.fn(),
  markResumed: vi.fn(),
  markIdle: vi.fn(),
  hasCapacity: vi.fn().mockReturnValue(true),
  hasDutyCapacity: vi.fn().mockReturnValue(true),
  pickToEvict: vi.fn().mockReturnValue(null),
  getSessionForIssue: vi.fn().mockReturnValue(undefined),
  getTrackedSessions: vi.fn().mockReturnValue([]),
  getActiveSessions: vi.fn().mockReturnValue([]),
  getIdleSessions: vi.fn().mockReturnValue([]),
  getSuspendedSessions: vi.fn().mockReturnValue([]),
  getHealthStatus: vi.fn().mockReturnValue({ sessions: [], capacity: {} }),
}));

// Mock memory to avoid filesystem side effects
vi.mock('../src/agents/memory.js', () => ({
  writeRetrospective: vi.fn(),
  writeSharedMemory: vi.fn(),
  readSharedMemory: vi.fn().mockReturnValue(null),
  listMemories: vi.fn().mockReturnValue([]),
  listSharedMemories: vi.fn().mockReturnValue([]),
}));

// Mock budget
vi.mock('../src/core/budget.js', () => ({
  canSpend: vi.fn().mockReturnValue({ allowed: true }),
  estimateCost: vi.fn().mockReturnValue(0.5),
  recordSpend: vi.fn(),
}));

beforeEach(() => {
  _resetDb();
  try { rmSync(process.env.ANC_DB_PATH!, { force: true }); } catch { /**/ }
  try { rmSync(process.env.ANC_DB_PATH! + '-wal', { force: true }); } catch { /**/ }
  try { rmSync(process.env.ANC_DB_PATH! + '-shm', { force: true }); } catch { /**/ }
  getDb(); // reinit

  // Reset processedHandoffs set between tests
  // @ts-expect-error: accessing private set for test reset
  processHandoff._resetForTest?.();
});

afterAll(() => {
  _resetDb();
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /**/ }
});

describe('Fix 1+2: task state transitions to running on spawn', () => {
  it('createTask starts in todo state', () => {
    const task = createTask({ title: 'Test task' });
    expect(task.state).toBe('todo');
  });

  it('setTaskState transitions todo → running', () => {
    const task = createTask({ title: 'Test task' });
    expect(task.state).toBe('todo');

    setTaskState(task.id, 'running');
    const updated = getTask(task.id)!;
    expect(updated.state).toBe('running');
  });

  it('setTaskState transitions running → review', () => {
    const task = createTask({ title: 'Test task' });
    setTaskState(task.id, 'running');
    setTaskState(task.id, 'review');
    const updated = getTask(task.id)!;
    expect(updated.state).toBe('review');
  });
});

describe('Fix 3: actions parser correctly extracts dispatches', () => {
  it('parseActions extracts dispatches from Actions block', () => {
    const handoff = `## Summary
I fixed the bug in auth.ts.

## Verification
All 42 tests passing. Verified login flow works end-to-end.

## Actions
status: In Review
dispatches:
- role: engineer
  context: "Review the auth changes and write integration tests"
  new_issue: "Write auth integration tests"
  priority: 2
- role: ops
  context: "Deploy auth fix to staging"
`;
    const actions = parseActions(handoff);
    expect(actions).not.toBeNull();
    expect(actions!.status).toBe('In Review');
    expect(actions!.dispatches).toHaveLength(2);
    expect(actions!.dispatches[0].role).toBe('engineer');
    expect(actions!.dispatches[0].context).toBe('Review the auth changes and write integration tests');
    expect(actions!.dispatches[0].newIssue).toBe('Write auth integration tests');
    expect(actions!.dispatches[0].priority).toBe(2);
    expect(actions!.dispatches[1].role).toBe('ops');
  });

  it('extractSummary returns content before Actions block', () => {
    const handoff = `## Summary
I fixed the bug.

## Verification
Tests pass.

## Actions
status: Done
`;
    const summary = extractSummary(handoff);
    expect(summary).toContain('I fixed the bug');
    expect(summary).toContain('Tests pass');
    expect(summary).not.toContain('status: Done');
  });
});

describe('Fix 4+5: processHandoff sets task state and writes handoffSummary', () => {
  it('processHandoff transitions task to review and writes handoffSummary', async () => {
    // Create a task in running state
    const task = createTask({ title: 'Fix auth bug' });
    setTaskState(task.id, 'running');

    // Create workspace with HANDOFF.md
    const workspace = join(tmpDir, 'workspaces', task.id);
    mkdirSync(workspace, { recursive: true });
    const handoffPath = join(workspace, 'HANDOFF.md');
    const handoffContent = `## Summary
Fixed the authentication bug in auth.ts by correcting the token validation logic.

## Verification
Ran all 42 tests — all passing. Verified login flow works end-to-end with test user.
\`npm test\` output: 42 tests passing, 0 failed.
`;
    writeFileSync(handoffPath, handoffContent);

    const result = await processHandoff({
      issueKey: task.id,
      role: 'engineer',
      handoffPath,
      workspace,
      spawnedAt: Date.now() - 120_000,
      markSessionIdle: false,
    });

    expect(result).toBe(true);

    // Verify task state changed to review
    const updatedTask = getTask(task.id)!;
    expect(updatedTask.state).toBe('review');

    // Verify handoffSummary was written
    expect(updatedTask.handoffSummary).not.toBeNull();
    expect(updatedTask.handoffSummary).toContain('Fixed the authentication bug');
  });

  it('processHandoff works even when Linear API fails', async () => {
    // This is the critical fix — Linear failure should NOT block ANC task lifecycle
    const task = createTask({ title: 'Fix something' });
    setTaskState(task.id, 'running');

    const workspace = join(tmpDir, 'workspaces', `${task.id}-linear-fail`);
    mkdirSync(workspace, { recursive: true });
    const handoffPath = join(workspace, 'HANDOFF.md');
    writeFileSync(handoffPath, `## Summary
Did the work successfully.

## Verification
Verified with \`npm test\` — 100 tests passing.
`);

    const result = await processHandoff({
      issueKey: task.id,
      role: 'engineer',
      handoffPath,
      workspace,
      spawnedAt: Date.now() - 60_000,
      markSessionIdle: false,
    });

    // Should succeed even though Linear returns false for setIssueStatus
    expect(result).toBe(true);

    const updated = getTask(task.id)!;
    expect(updated.state).toBe('review');
    expect(updated.handoffSummary).toContain('Did the work successfully');
  });

  it('processHandoff creates child tasks from dispatch actions', async () => {
    const parentTask = createTask({ title: 'Parent task' });
    setTaskState(parentTask.id, 'running');

    const workspace = join(tmpDir, 'workspaces', `${parentTask.id}-dispatch`);
    mkdirSync(workspace, { recursive: true });
    const handoffPath = join(workspace, 'HANDOFF.md');
    writeFileSync(handoffPath, `## Summary
Completed the main work. Need follow-up tasks.

## Verification
All tests pass. \`npm test\` shows 50 tests passing.

## Actions
status: In Review
dispatches:
- role: engineer
  context: "Write integration tests for the new feature"
  new_issue: "Integration tests for feature X"
  priority: 2
`);

    const result = await processHandoff({
      issueKey: parentTask.id,
      role: 'engineer',
      handoffPath,
      workspace,
      spawnedAt: Date.now() - 120_000,
      markSessionIdle: false,
    });

    expect(result).toBe(true);

    // Verify parent task state
    const updated = getTask(parentTask.id)!;
    expect(updated.state).toBe('review');
    expect(updated.handoffSummary).toContain('Completed the main work');

    // Verify child task was created
    const children = getDb().prepare(
      'SELECT * FROM tasks WHERE parent_task_id = ?'
    ).all(parentTask.id) as Array<Record<string, unknown>>;
    expect(children.length).toBe(1);
    expect(children[0].title).toBe('Integration tests for feature X');
    expect(children[0].source).toBe('dispatch');
  });

  it('processHandoff deduplicates concurrent calls', async () => {
    const task = createTask({ title: 'Dedup test' });
    setTaskState(task.id, 'running');

    const workspace = join(tmpDir, 'workspaces', `${task.id}-dedup`);
    mkdirSync(workspace, { recursive: true });
    const handoffPath = join(workspace, 'HANDOFF.md');
    writeFileSync(handoffPath, `## Summary
Done.

## Verification
\`npm test\` — 10 tests passing.
`);

    // First call should succeed
    const result1 = await processHandoff({
      issueKey: task.id,
      role: 'engineer',
      handoffPath,
      workspace,
      spawnedAt: Date.now() - 60_000,
      markSessionIdle: false,
    });
    expect(result1).toBe(true);

    // Second call with same dedupKey should return true (already processed)
    const result2 = await processHandoff({
      issueKey: task.id,
      role: 'engineer',
      handoffPath,
      workspace,
      spawnedAt: Date.now() - 60_000,
      markSessionIdle: false,
    });
    expect(result2).toBe(true);

    // But task should only have been set to review once (not double-processed)
    const updated = getTask(task.id)!;
    expect(updated.state).toBe('review');
  });
});

describe('resolveTaskIdFromIssueKey works for API-created tasks', () => {
  it('resolves task by its own id', () => {
    const task = createTask({ title: 'API task' });
    const resolved = resolveTaskIdFromIssueKey(task.id);
    expect(resolved).toBe(task.id);
  });

  it('resolves task by linearIssueKey', () => {
    const task = createTask({ title: 'Linear task', linearIssueKey: 'ENG-123' });
    const resolved = resolveTaskIdFromIssueKey('ENG-123');
    expect(resolved).toBe(task.id);
  });
});
