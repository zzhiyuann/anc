import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmpDir = mkdtempSync(join(tmpdir(), 'anc-tasks-test-'));
process.env.ANC_DB_PATH = join(tmpDir, 'state.db');

const { _resetDb, getDb } = await import('../src/core/db.js');
const {
  createTask, getTask, listTasks, updateTask, setTaskState,
  getTaskChildren, resolveTaskIdFromIssueKey,
} = await import('../src/core/tasks.js');

beforeEach(() => {
  _resetDb();
  // Clear the db file between tests
  try { rmSync(process.env.ANC_DB_PATH!, { force: true }); } catch { /**/ }
  try { rmSync(process.env.ANC_DB_PATH! + '-wal', { force: true }); } catch { /**/ }
  try { rmSync(process.env.ANC_DB_PATH! + '-shm', { force: true }); } catch { /**/ }
  getDb(); // reinitialize schema
});

afterAll(() => {
  _resetDb();
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /**/ }
});

describe('tasks CRUD', () => {
  it('createTask with defaults', () => {
    const t = createTask({ title: 'Fix bug' });
    expect(t.id).toMatch(/^task-/);
    expect(t.title).toBe('Fix bug');
    expect(t.state).toBe('todo');
    expect(t.priority).toBe(3);
    expect(t.source).toBe('dashboard');
    expect(t.createdBy).toBe('ceo');
  });

  it('createTask with explicit fields', () => {
    const t = createTask({
      title: 'Research', priority: 1, source: 'linear',
      projectId: 'system', description: 'lorem',
      linearIssueKey: 'RYA-42', createdBy: 'agent:ops',
    });
    expect(t.priority).toBe(1);
    expect(t.source).toBe('linear');
    expect(t.projectId).toBe('system');
    expect(t.description).toBe('lorem');
    expect(t.linearIssueKey).toBe('RYA-42');
  });

  it('getTask returns null for unknown id', () => {
    expect(getTask('nope')).toBeNull();
  });

  it('getTask returns a task', () => {
    const t = createTask({ title: 'A' });
    const fetched = getTask(t.id)!;
    expect(fetched.id).toBe(t.id);
    expect(fetched.title).toBe('A');
  });

  it('listTasks returns all by default in desc order', () => {
    const a = createTask({ title: 'A', createdAt: 1000 });
    const b = createTask({ title: 'B', createdAt: 2000 });
    const list = listTasks();
    expect(list.length).toBe(2);
    expect(list[0].id).toBe(b.id);
    expect(list[1].id).toBe(a.id);
  });

  it('listTasks filters by state', () => {
    createTask({ title: 'A', state: 'todo' });
    createTask({ title: 'B', state: 'running' });
    createTask({ title: 'C', state: 'done' });
    expect(listTasks({ state: 'running' }).length).toBe(1);
    expect(listTasks({ state: 'done' }).length).toBe(1);
  });

  it('listTasks filters by projectId', () => {
    createTask({ title: 'A', projectId: 'system' });
    createTask({ title: 'B', projectId: null });
    expect(listTasks({ projectId: 'system' }).length).toBe(1);
  });

  it('updateTask patches given fields', () => {
    const t = createTask({ title: 'A' });
    const updated = updateTask(t.id, { title: 'A2', priority: 1 })!;
    expect(updated.title).toBe('A2');
    expect(updated.priority).toBe(1);
  });

  it('setTaskState done fills completed_at', () => {
    const t = createTask({ title: 'A' });
    setTaskState(t.id, 'done', 999);
    const after = getTask(t.id)!;
    expect(after.state).toBe('done');
    expect(after.completedAt).toBe(999);
  });

  it('getTaskChildren returns direct children in created order', () => {
    const parent = createTask({ title: 'parent' });
    createTask({ title: 'c1', parentTaskId: parent.id, createdAt: 1000 });
    createTask({ title: 'c2', parentTaskId: parent.id, createdAt: 2000 });
    createTask({ title: 'other' });
    const kids = getTaskChildren(parent.id);
    expect(kids.length).toBe(2);
    expect(kids[0].title).toBe('c1');
    expect(kids[1].title).toBe('c2');
  });

  it('resolveTaskIdFromIssueKey finds by linear_issue_key', () => {
    const t = createTask({ title: 'A', linearIssueKey: 'RYA-99' });
    expect(resolveTaskIdFromIssueKey('RYA-99')).toBe(t.id);
  });

  it('resolveTaskIdFromIssueKey returns null for unknown key', () => {
    expect(resolveTaskIdFromIssueKey('nope')).toBeNull();
  });

  it('orphan sessions (no task_id) are cleaned up on init', () => {
    const d = getDb();
    // Insert a raw session row with no task_id
    d.prepare(`
      INSERT INTO sessions
      (issue_key, role, tmux_session, state, spawned_at, priority,
       ceo_assigned, handoff_processed, use_continue, is_duty)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('RYA-1', 'engineer', 'anc-engineer-RYA-1', 'active', 1111, 2, 0, 0, 0, 0);
    // Force re-init — orphan sessions should be cleaned up
    _resetDb();
    const d2 = getDb();
    const row = d2.prepare('SELECT * FROM sessions WHERE issue_key = ?').get('RYA-1') as Record<string, unknown> | undefined;
    expect(row).toBeUndefined(); // orphan cleaned up
    const task = d2.prepare("SELECT * FROM tasks WHERE id LIKE 'migrated-%'").get() as Record<string, unknown> | undefined;
    expect(task).toBeUndefined(); // no migrated tasks created
  });

  it('system project is seeded on init', () => {
    const row = getDb().prepare("SELECT * FROM projects WHERE id = 'system'").get() as Record<string, unknown> | undefined;
    expect(row).toBeTruthy();
    expect(row!.name).toBe('System');
  });
});
