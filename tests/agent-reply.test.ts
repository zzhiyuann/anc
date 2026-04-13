/**
 * Agent reply auto-comment tests — verify that Stop hook events with
 * last_assistant_message produce task_comments visible in the dashboard.
 */

import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import Database from 'better-sqlite3';

// Prevent budget.yaml reads from hitting real filesystem
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: (path: string) => {
      if (typeof path === 'string' && path.endsWith('budget.yaml')) return false;
      return (actual.existsSync as (p: string) => boolean)(path);
    },
  };
});

import { processHookEvent, maybePostAgentReply } from '../src/api/hook-handler.js';
import { addTaskComment, getTask } from '../src/core/tasks.js';
import { _setDbForTesting } from '../src/core/db.js';
import { reloadConfig } from '../src/core/budget.js';

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
      due_date TEXT
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
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE budget_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_role TEXT NOT NULL,
      issue_key TEXT NOT NULL,
      tokens INTEGER NOT NULL DEFAULT 0,
      cost_usd REAL NOT NULL DEFAULT 0,
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
  `);
  return d;
}

function insertTask(id: string, title = 'Test task'): void {
  testDb.prepare(
    `INSERT INTO tasks (id, title, state, priority, source, created_by, created_at)
     VALUES (?, ?, 'running', 3, 'dashboard', 'ceo', ?)`,
  ).run(id, title, Date.now());
}

function getComments(taskId: string): Array<{ author: string; body: string }> {
  return testDb.prepare(
    'SELECT author, body FROM task_comments WHERE task_id = ? ORDER BY id ASC',
  ).all(taskId) as Array<{ author: string; body: string }>;
}

beforeEach(() => {
  testDb = freshDb();
  _setDbForTesting(testDb);
  reloadConfig();
});

afterAll(() => {
  _setDbForTesting(null);
});

// --- maybePostAgentReply (unit) ---

describe('maybePostAgentReply', () => {
  it('posts comment when Stop has last_assistant_message and stop_hook_active=false', () => {
    insertTask('task-1');
    const result = maybePostAgentReply('task-1', 'engineer', {
      hook_event_name: 'Stop',
      stop_hook_active: false,
      last_assistant_message: 'The answer is 4.',
    } as any);
    expect(result).toBe(true);
    const comments = getComments('task-1');
    expect(comments).toHaveLength(1);
    expect(comments[0].author).toBe('agent:engineer');
    expect(comments[0].body).toBe('The answer is 4.');
  });

  it('skips when stop_hook_active is true (mid-tool-call)', () => {
    insertTask('task-2');
    const result = maybePostAgentReply('task-2', 'engineer', {
      hook_event_name: 'Stop',
      stop_hook_active: true,
      last_assistant_message: 'Some intermediate text',
    } as any);
    expect(result).toBe(false);
    expect(getComments('task-2')).toHaveLength(0);
  });

  it('skips when last_assistant_message is empty', () => {
    insertTask('task-3');
    const result = maybePostAgentReply('task-3', 'ops', {
      hook_event_name: 'Stop',
      stop_hook_active: false,
      last_assistant_message: '',
    } as any);
    expect(result).toBe(false);
    expect(getComments('task-3')).toHaveLength(0);
  });

  it('skips when last_assistant_message is missing', () => {
    insertTask('task-4');
    const result = maybePostAgentReply('task-4', 'ops', {
      hook_event_name: 'Stop',
      stop_hook_active: false,
    } as any);
    expect(result).toBe(false);
    expect(getComments('task-4')).toHaveLength(0);
  });

  it('skips when last_assistant_message is whitespace only', () => {
    insertTask('task-5');
    const result = maybePostAgentReply('task-5', 'engineer', {
      hook_event_name: 'Stop',
      stop_hook_active: false,
      last_assistant_message: '   \n  ',
    } as any);
    expect(result).toBe(false);
    expect(getComments('task-5')).toHaveLength(0);
  });

  it('trims whitespace from message body', () => {
    insertTask('task-6');
    maybePostAgentReply('task-6', 'strategist', {
      hook_event_name: 'Stop',
      stop_hook_active: false,
      last_assistant_message: '  Hello CEO  \n',
    } as any);
    const comments = getComments('task-6');
    expect(comments[0].body).toBe('Hello CEO');
  });

  it('posts even short messages like "Done"', () => {
    insertTask('task-7');
    const result = maybePostAgentReply('task-7', 'engineer', {
      hook_event_name: 'Stop',
      stop_hook_active: false,
      last_assistant_message: 'Done',
    } as any);
    expect(result).toBe(true);
    expect(getComments('task-7')[0].body).toBe('Done');
  });

  it('returns false for non-existent task (no crash)', () => {
    const result = maybePostAgentReply('no-such-task', 'engineer', {
      hook_event_name: 'Stop',
      stop_hook_active: false,
      last_assistant_message: 'Hello',
    } as any);
    expect(result).toBe(false);
  });
});

// --- Integration via processHookEvent ---

describe('processHookEvent auto-posts agent reply comments (restored behavior)', () => {
  it('Stop event WITH last_assistant_message auto-posts a comment', () => {
    insertTask('task-int-1');
    processHookEvent('task-int-1', 'engineer', {
      hook_event_name: 'Stop',
      stop_hook_active: false,
      last_assistant_message: '2 + 2 = 4',
    });
    // Auto-comment is restored via maybePostAgentReply in processHookEvent
    const comments = getComments('task-int-1');
    expect(comments).toHaveLength(1);
    expect(comments[0].author).toBe('agent:engineer');
    expect(comments[0].body).toBe('2 + 2 = 4');
  });

  it('event logging still works alongside auto-comment', () => {
    insertTask('task-int-2');
    const result = processHookEvent('task-int-2', 'engineer', {
      hook_event_name: 'Stop',
      stop_hook_active: false,
      last_assistant_message: 'Final summary here',
    });
    expect(result.ok).toBe(true);
    expect(result.eventType).toBe('agent:session-stop');
    // Event is logged to task_events
    const events = testDb.prepare('SELECT * FROM task_events WHERE task_id = ?').all('task-int-2');
    expect(events.length).toBeGreaterThan(0);
  });
});
