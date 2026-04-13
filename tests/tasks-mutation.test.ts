import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmpDir = mkdtempSync(join(tmpdir(), 'anc-tasks-mut-test-'));
process.env.ANC_DB_PATH = join(tmpDir, 'state.db');

const { _resetDb, getDb } = await import('../src/core/db.js');
const { createTask, getTask, updateTask, getChildCounts } = await import('../src/core/tasks.js');
const { setTaskLabels, getTaskLabels } = await import('../src/core/labels.js');

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

describe('task PATCH new fields', () => {
  it('createTask defaults assignee and dueDate to null', () => {
    const t = createTask({ title: 'T' });
    expect(t.assignee).toBeNull();
    expect(t.dueDate).toBeNull();
  });

  it('updateTask persists assignee', () => {
    const t = createTask({ title: 'T' });
    const u = updateTask(t.id, { assignee: 'alice' })!;
    expect(u.assignee).toBe('alice');
    expect(getTask(t.id)!.assignee).toBe('alice');
  });

  it('updateTask can clear assignee back to null', () => {
    const t = createTask({ title: 'T', assignee: 'bob' });
    expect(t.assignee).toBe('bob');
    const u = updateTask(t.id, { assignee: null })!;
    expect(u.assignee).toBeNull();
  });

  it('updateTask persists dueDate', () => {
    const t = createTask({ title: 'T' });
    const u = updateTask(t.id, { dueDate: '2026-05-01' })!;
    expect(u.dueDate).toBe('2026-05-01');
    expect(getTask(t.id)!.dueDate).toBe('2026-05-01');
  });

  it('updateTask round-trips title/description/priority/state alongside new fields', () => {
    const t = createTask({ title: 'T' });
    const u = updateTask(t.id, {
      title: 'Renamed',
      description: 'desc',
      priority: 1,
      assignee: 'carol',
      dueDate: '2027-01-15',
    })!;
    expect(u.title).toBe('Renamed');
    expect(u.description).toBe('desc');
    expect(u.priority).toBe(1);
    expect(u.assignee).toBe('carol');
    expect(u.dueDate).toBe('2027-01-15');
  });
});

describe('label join round-trip via tasks', () => {
  it('attaches labels to a task and reads them back', () => {
    const t = createTask({ title: 'T' });
    setTaskLabels(t.id, ['bug', 'urgent']);
    expect(getTaskLabels(t.id).sort()).toEqual(['bug', 'urgent']);
  });

  it('replacing labels removes the old ones', () => {
    const t = createTask({ title: 'T' });
    setTaskLabels(t.id, ['bug']);
    setTaskLabels(t.id, ['feature']);
    expect(getTaskLabels(t.id)).toEqual(['feature']);
  });
});

describe('getChildCounts', () => {
  it('returns counts for each parent id', () => {
    const parent = createTask({ title: 'P' });
    const child1 = createTask({ title: 'C1', parentTaskId: parent.id });
    createTask({ title: 'C2', parentTaskId: parent.id });
    createTask({ title: 'GC1', parentTaskId: child1.id });
    const counts = getChildCounts([parent.id, child1.id]);
    expect(counts[parent.id]).toBe(2);
    expect(counts[child1.id]).toBe(1);
  });

  it('returns empty object when no parents', () => {
    expect(getChildCounts([])).toEqual({});
  });

  it('omits parents with zero children', () => {
    const t = createTask({ title: 'lonely' });
    const counts = getChildCounts([t.id]);
    expect(counts[t.id]).toBeUndefined();
  });
});
