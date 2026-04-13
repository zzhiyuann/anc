/**
 * Feedback loop tests — child→parent notification on task completion.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import Database from 'better-sqlite3';
import { _setDbForTesting, getDb } from '../src/core/db.js';
import { bus } from '../src/bus.js';

// Mock runner module before importing on-feedback
vi.mock('../src/runtime/runner.js', () => ({
  sessionExists: vi.fn(() => false),
  sendToAgent: vi.fn(() => true),
}));

vi.mock('../src/runtime/health.js', () => ({
  getSessionForIssue: vi.fn(() => undefined),
  getTrackedSessions: vi.fn(() => []),
  trackSession: vi.fn(),
  markIdle: vi.fn(),
  markSuspended: vi.fn(),
}));

import { sessionExists, sendToAgent } from '../src/runtime/runner.js';
import { getSessionForIssue } from '../src/runtime/health.js';
import { registerFeedbackHandlers, deliverPendingFeedback } from '../src/hooks/on-feedback.js';

function freshDb(): Database.Database {
  const d = new Database(':memory:');
  d.exec(`
    CREATE TABLE tasks (
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
      created_at INTEGER NOT NULL DEFAULT 0,
      completed_at INTEGER,
      handoff_summary TEXT,
      assignee TEXT,
      due_date TEXT,
      progress INTEGER DEFAULT 0
    );
    CREATE TABLE task_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      role TEXT,
      type TEXT NOT NULL,
      payload TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
    CREATE TABLE task_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      author TEXT NOT NULL,
      body TEXT NOT NULL,
      parent_id INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
    CREATE TABLE sessions (
      issue_key TEXT PRIMARY KEY,
      role TEXT NOT NULL,
      tmux_session TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'active',
      spawned_at INTEGER NOT NULL,
      task_id TEXT
    );
    CREATE TABLE task_feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      parent_task_id TEXT NOT NULL,
      child_task_id TEXT NOT NULL,
      summary TEXT,
      delivered INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
  `);
  return d;
}

function insertTask(d: Database.Database, id: string, title: string, parentId: string | null, state = 'todo', summary: string | null = null): void {
  d.prepare(
    'INSERT INTO tasks (id, title, state, parent_task_id, handoff_summary, linear_issue_key) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, title, state, parentId, summary, id);
}

let testDb: Database.Database;

beforeEach(() => {
  testDb = freshDb();
  _setDbForTesting(testDb);
  vi.clearAllMocks();
  // Register handlers fresh for each test
  bus.removeAllListeners('task:completed');
  bus.removeAllListeners('task:all-children-done');
  registerFeedbackHandlers();
});

afterAll(() => {
  _setDbForTesting(null);
});

describe('feedback loop', () => {
  it('notifies parent when child completes and parent session is alive', async () => {
    insertTask(testDb, 'parent-1', 'Parent Task', null, 'running');
    insertTask(testDb, 'child-1', 'Child Task', 'parent-1', 'done', 'Fixed the bug');

    vi.mocked(getSessionForIssue).mockReturnValue({
      role: 'engineer',
      issueKey: 'parent-1',
      tmuxSession: 'anc-engineer-parent-1',
      state: 'active',
      spawnedAt: Date.now(),
      priority: 3,
      ceoAssigned: false,
      useContinue: false,
      isDuty: false,
    });
    vi.mocked(sessionExists).mockReturnValue(true);
    vi.mocked(sendToAgent).mockReturnValue(true);

    await bus.emit('task:completed', { taskId: 'child-1', handoffSummary: 'Fixed the bug' });

    expect(sendToAgent).toHaveBeenCalledWith(
      'anc-engineer-parent-1',
      expect.stringContaining('Sub-task completed: Child Task'),
    );

    // Should have a delivered event
    const events = testDb.prepare("SELECT * FROM task_events WHERE type = 'task:feedback-delivered'").all();
    expect(events).toHaveLength(1);
  });

  it('stores pending feedback when parent session is dead', async () => {
    insertTask(testDb, 'parent-2', 'Parent Task', null, 'running');
    insertTask(testDb, 'child-2', 'Child Task', 'parent-2', 'done', 'Done');

    vi.mocked(getSessionForIssue).mockReturnValue(undefined);

    await bus.emit('task:completed', { taskId: 'child-2', handoffSummary: 'Done' });

    expect(sendToAgent).not.toHaveBeenCalled();

    // Should have a pending event
    const events = testDb.prepare("SELECT * FROM task_events WHERE type = 'task:feedback-pending'").all();
    expect(events).toHaveLength(1);
  });

  it('emits task:all-children-done when all children complete', async () => {
    insertTask(testDb, 'parent-3', 'Parent Task', null, 'running');
    insertTask(testDb, 'child-3a', 'Child A', 'parent-3', 'done', 'A done');
    insertTask(testDb, 'child-3b', 'Child B', 'parent-3', 'done', 'B done');

    vi.mocked(getSessionForIssue).mockReturnValue(undefined);

    const allDonePromise = new Promise<{ parentTaskId: string }>((resolve) => {
      bus.on('task:all-children-done', resolve);
    });

    await bus.emit('task:completed', { taskId: 'child-3b', handoffSummary: 'B done' });

    const result = await allDonePromise;
    expect(result.parentTaskId).toBe('parent-3');
  });

  it('delivers pending feedback on resume', () => {
    insertTask(testDb, 'parent-4', 'Parent Task', null, 'running');

    // Insert pending feedback
    testDb.prepare(
      "INSERT INTO task_events (task_id, role, type, payload) VALUES (?, ?, ?, ?)"
    ).run('parent-4', 'system', 'task:feedback-pending', JSON.stringify({
      childTaskId: 'child-4',
      text: 'Sub-task completed: Child. Summary: Done.',
    }));

    vi.mocked(sendToAgent).mockReturnValue(true);

    const delivered = deliverPendingFeedback('parent-4', 'anc-engineer-parent-4');
    expect(delivered).toBe(1);
    expect(sendToAgent).toHaveBeenCalledWith(
      'anc-engineer-parent-4',
      'Sub-task completed: Child. Summary: Done.',
    );

    // Pending should be removed, delivered added
    const pending = testDb.prepare("SELECT * FROM task_events WHERE type = 'task:feedback-pending'").all();
    expect(pending).toHaveLength(0);
    const deliveredEvents = testDb.prepare("SELECT * FROM task_events WHERE type = 'task:feedback-delivered'").all();
    expect(deliveredEvents).toHaveLength(1);
  });

  it('no-op when task has no parent', async () => {
    insertTask(testDb, 'orphan-1', 'Orphan Task', null, 'done', 'Done');

    await bus.emit('task:completed', { taskId: 'orphan-1', handoffSummary: 'Done' });

    expect(sendToAgent).not.toHaveBeenCalled();
    const events = testDb.prepare("SELECT * FROM task_events WHERE type LIKE 'task:feedback%'").all();
    expect(events).toHaveLength(0);
  });
});
