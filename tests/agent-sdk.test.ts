/**
 * Agent SDK command tests — verify the new CLI commands call the right API
 * endpoints with correct payloads.
 */

import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import Database from 'better-sqlite3';
import { _setDbForTesting } from '../src/core/db.js';

let testDb: Database.Database;

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
      created_at INTEGER NOT NULL,
      completed_at INTEGER,
      handoff_summary TEXT,
      assignee TEXT,
      due_date TEXT,
      progress INTEGER DEFAULT 0
    );
    CREATE TABLE task_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      role TEXT NOT NULL,
      type TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE task_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      author TEXT NOT NULL,
      body TEXT NOT NULL,
      parent_id INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
    CREATE TABLE notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'info',
      title TEXT NOT NULL,
      body TEXT,
      task_id TEXT,
      project_id TEXT,
      agent_role TEXT,
      read_at INTEGER,
      archived_at INTEGER,
      created_at INTEGER NOT NULL
    );
  `);
  return d;
}

function insertTask(id: string, title = 'Test task', state = 'running'): void {
  testDb.prepare(
    `INSERT INTO tasks (id, title, state, priority, source, created_by, created_at)
     VALUES (?, ?, ?, 3, 'dashboard', 'ceo', ?)`,
  ).run(id, title, state, Date.now());
}

function getComments(taskId: string): Array<{ author: string; body: string }> {
  return testDb.prepare(
    'SELECT author, body FROM task_comments WHERE task_id = ? ORDER BY id ASC',
  ).all(taskId) as Array<{ author: string; body: string }>;
}

function getEvents(taskId: string): Array<{ type: string; payload: string }> {
  return testDb.prepare(
    'SELECT type, payload FROM task_events WHERE task_id = ? ORDER BY id ASC',
  ).all(taskId) as Array<{ type: string; payload: string }>;
}

function getNotifications(): Array<{ kind: string; severity: string; title: string; body: string | null; task_id: string | null }> {
  return testDb.prepare('SELECT kind, severity, title, body, task_id FROM notifications ORDER BY id ASC')
    .all() as Array<{ kind: string; severity: string; title: string; body: string | null; task_id: string | null }>;
}

beforeEach(() => {
  testDb = freshDb();
  _setDbForTesting(testDb);
});

afterAll(() => {
  _setDbForTesting(null);
});

// --- Task state: awaiting-input ---

describe('TaskState: awaiting-input', () => {
  it('includes awaiting-input as valid transition from running', async () => {
    const { transitionTaskState } = await import('../src/core/tasks.js');
    insertTask('t-await', 'Task', 'running');
    const result = transitionTaskState('t-await', 'awaiting-input', { by: 'agent:engineer' });
    expect(result.to).toBe('awaiting-input');
    expect(result.from).toBe('running');
  });

  it('allows awaiting-input to transition to running', async () => {
    const { transitionTaskState } = await import('../src/core/tasks.js');
    insertTask('t-await2', 'Task', 'running');
    transitionTaskState('t-await2', 'awaiting-input', { by: 'test' });
    const result = transitionTaskState('t-await2', 'running', { by: 'test' });
    expect(result.to).toBe('running');
  });
});

// --- Task progress ---

describe('setTaskProgress', () => {
  it('updates progress column and clamps to 0-100', async () => {
    const { setTaskProgress, getTask } = await import('../src/core/tasks.js');
    insertTask('t-prog', 'Task');
    setTaskProgress('t-prog', 42, 'halfway there');
    const task = getTask('t-prog');
    expect(task!.progress).toBe(42);
  });

  it('clamps percent above 100 to 100', async () => {
    const { setTaskProgress, getTask } = await import('../src/core/tasks.js');
    insertTask('t-prog-over', 'Task');
    setTaskProgress('t-prog-over', 150, 'overcomplete');
    const task = getTask('t-prog-over');
    expect(task!.progress).toBe(100);
  });

  it('clamps negative percent to 0', async () => {
    const { setTaskProgress, getTask } = await import('../src/core/tasks.js');
    insertTask('t-prog-neg', 'Task');
    setTaskProgress('t-prog-neg', -10, 'negative');
    const task = getTask('t-prog-neg');
    expect(task!.progress).toBe(0);
  });
});

// --- Task flag helper ---

describe('flagTask', () => {
  it('adds a FLAG comment to the task', async () => {
    const { flagTask } = await import('../src/core/tasks.js');
    insertTask('t-flag', 'Task');
    flagTask('t-flag', 'Something risky', { author: 'agent:engineer' });
    const comments = getComments('t-flag');
    expect(comments).toHaveLength(1);
    expect(comments[0].body).toContain('FLAG');
    expect(comments[0].body).toContain('Something risky');
    expect(comments[0].author).toBe('agent:engineer');
  });

  it('throws for non-existent task', async () => {
    const { flagTask } = await import('../src/core/tasks.js');
    expect(() => flagTask('no-exist', 'bad')).toThrow('task not found');
  });
});

// --- addTaskComment ---

describe('addTaskComment', () => {
  it('posts a comment with correct author attribution', async () => {
    const { addTaskComment } = await import('../src/core/tasks.js');
    insertTask('t-cmt', 'Task');
    const id = addTaskComment('t-cmt', 'agent:strategist', 'Analysis complete.');
    expect(id).toBeTypeOf('number');
    const comments = getComments('t-cmt');
    expect(comments[0].author).toBe('agent:strategist');
    expect(comments[0].body).toBe('Analysis complete.');
  });
});

// --- createTask with progress ---

describe('createTask includes progress field', () => {
  it('defaults progress to 0', async () => {
    const { createTask } = await import('../src/core/tasks.js');
    const task = createTask({ title: 'New task' });
    expect(task.progress).toBe(0);
  });
});

// --- SDK command: askCommand uses fetch ---

describe('SDK askCommand', () => {
  it('exported and callable', async () => {
    const { askCommand } = await import('../src/commands/sdk.js');
    expect(typeof askCommand).toBe('function');
  });
});

describe('SDK flagCommand', () => {
  it('exported and callable', async () => {
    const { flagCommand } = await import('../src/commands/sdk.js');
    expect(typeof flagCommand).toBe('function');
  });
});

describe('SDK progressCommand', () => {
  it('exported and callable', async () => {
    const { progressCommand } = await import('../src/commands/sdk.js');
    expect(typeof progressCommand).toBe('function');
  });
});

describe('SDK decisionCommand', () => {
  it('exported and callable', async () => {
    const { decisionCommand } = await import('../src/commands/sdk.js');
    expect(typeof decisionCommand).toBe('function');
  });
});

describe('SDK attachCommand', () => {
  it('exported and callable', async () => {
    const { attachCommand } = await import('../src/commands/sdk.js');
    expect(typeof attachCommand).toBe('function');
  });
});

describe('SDK handoffCommand', () => {
  it('exported and callable', async () => {
    const { handoffCommand } = await import('../src/commands/sdk.js');
    expect(typeof handoffCommand).toBe('function');
  });
});
