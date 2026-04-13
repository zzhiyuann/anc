import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmpDir = mkdtempSync(join(tmpdir(), 'anc-task-status-test-'));
process.env.ANC_DB_PATH = join(tmpDir, 'state.db');

const { _resetDb, getDb } = await import('../src/core/db.js');
const {
  createTask, getTask, transitionTaskState, getLegalTransitions,
} = await import('../src/core/tasks.js');
const { bus } = await import('../src/bus.js');

beforeEach(() => {
  _resetDb();
  try { rmSync(process.env.ANC_DB_PATH!, { force: true }); } catch { /**/ }
  try { rmSync(process.env.ANC_DB_PATH! + '-wal', { force: true }); } catch { /**/ }
  try { rmSync(process.env.ANC_DB_PATH! + '-shm', { force: true }); } catch { /**/ }
  getDb();
});

afterAll(() => {
  _resetDb();
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /**/ }
});

describe('transitionTaskState — legal transitions', () => {
  it('todo → running updates state and emits bus event', async () => {
    const t = createTask({ title: 'demo' });
    const events: unknown[] = [];
    const off = (bus as unknown as {
      on: (e: string, l: (d: unknown) => void) => () => void;
    }).on('task:status-changed', (d) => { events.push(d); });

    const result = transitionTaskState(t.id, 'running', { by: 'tester' });

    expect(result.from).toBe('todo');
    expect(result.to).toBe('running');
    expect(result.task.state).toBe('running');
    expect(getTask(t.id)?.state).toBe('running');

    // Allow microtask queue to drain async emit
    await new Promise(r => setTimeout(r, 5));
    expect(events).toHaveLength(1);
    off();
  });

  it('running → review is allowed', () => {
    const t = createTask({ title: 'a', state: 'running' });
    const r = transitionTaskState(t.id, 'review');
    expect(r.task.state).toBe('review');
  });

  it('running → done sets completed_at', () => {
    const t = createTask({ title: 'a', state: 'running' });
    const before = Date.now();
    transitionTaskState(t.id, 'done');
    const after = Date.now();
    const fresh = getTask(t.id)!;
    expect(fresh.state).toBe('done');
    expect(fresh.completedAt).not.toBeNull();
    expect(fresh.completedAt!).toBeGreaterThanOrEqual(before);
    expect(fresh.completedAt!).toBeLessThanOrEqual(after);
  });

  it('review → running (reopen) is allowed', () => {
    const t = createTask({ title: 'a', state: 'review' });
    const r = transitionTaskState(t.id, 'running');
    expect(r.task.state).toBe('running');
  });

  it('review → done is allowed', () => {
    const t = createTask({ title: 'a', state: 'review' });
    expect(() => transitionTaskState(t.id, 'done')).not.toThrow();
  });

  it('writes a task_events row on transition', () => {
    const t = createTask({ title: 'a', state: 'running' });
    transitionTaskState(t.id, 'done', { by: 'eng', note: 'shipped' });
    const row = getDb().prepare(
      'SELECT * FROM task_events WHERE task_id = ? ORDER BY id DESC LIMIT 1'
    ).get(t.id) as Record<string, unknown>;
    expect(row.type).toBe('task:state-changed');
    expect(row.role).toBe('eng');
    const payload = JSON.parse(row.payload as string);
    expect(payload).toMatchObject({ from: 'running', to: 'done', by: 'eng', note: 'shipped' });
  });
});

describe('transitionTaskState — illegal transitions', () => {
  it('rejects todo → review', () => {
    const t = createTask({ title: 'a' });
    expect(() => transitionTaskState(t.id, 'review')).toThrow(/illegal/);
  });

  it('rejects todo → done', () => {
    const t = createTask({ title: 'a' });
    expect(() => transitionTaskState(t.id, 'done')).toThrow(/illegal/);
  });

  it('rejects done → anything (terminal)', () => {
    const t = createTask({ title: 'a', state: 'running' });
    transitionTaskState(t.id, 'done');
    expect(() => transitionTaskState(t.id, 'running')).toThrow(/illegal/);
  });

  it('rejects failed → done (terminal)', () => {
    const t = createTask({ title: 'a', state: 'running' });
    transitionTaskState(t.id, 'failed');
    expect(() => transitionTaskState(t.id, 'done')).toThrow(/illegal/);
  });

  it('rejects canceled → running', () => {
    const t = createTask({ title: 'a', state: 'running' });
    transitionTaskState(t.id, 'canceled');
    expect(() => transitionTaskState(t.id, 'running')).toThrow(/illegal/);
  });

  it('rejects same-state transition', () => {
    const t = createTask({ title: 'a', state: 'running' });
    expect(() => transitionTaskState(t.id, 'running')).toThrow(/already in state/);
  });

  it('rejects unknown task id', () => {
    expect(() => transitionTaskState('task-nope', 'running')).toThrow(/not found/);
  });
});

describe('getLegalTransitions', () => {
  it('exposes the matrix', () => {
    expect(getLegalTransitions('todo').sort()).toEqual(['canceled', 'running']);
    expect(getLegalTransitions('done')).toEqual([]);
    expect(getLegalTransitions('failed')).toEqual([]);
    expect(getLegalTransitions('review').sort()).toEqual(['canceled', 'done', 'running']);
  });
});
