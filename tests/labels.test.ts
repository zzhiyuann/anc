import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmpDir = mkdtempSync(join(tmpdir(), 'anc-labels-test-'));
process.env.ANC_DB_PATH = join(tmpDir, 'state.db');

const { _resetDb, getDb } = await import('../src/core/db.js');
const { createTask } = await import('../src/core/tasks.js');
const {
  listLabels, createLabel, deleteLabel, setTaskLabels, getTaskLabels,
  getLabelByName, getLabelsForTasks,
} = await import('../src/core/labels.js');

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

describe('labels CRUD', () => {
  it('seeds the four default labels on init', () => {
    const labels = listLabels();
    const names = labels.map(l => l.name).sort();
    expect(names).toEqual(['bug', 'feature', 'research', 'urgent']);
    const bug = getLabelByName('bug')!;
    expect(bug.color).toBe('#ef4444');
  });

  it('createLabel adds a new label', () => {
    const l = createLabel({ name: 'tech-debt', color: '#222' });
    expect(l.name).toBe('tech-debt');
    expect(l.color).toBe('#222');
    expect(listLabels().some(x => x.name === 'tech-debt')).toBe(true);
  });

  it('createLabel is idempotent on existing name', () => {
    const a = createLabel({ name: 'bug' });
    const b = createLabel({ name: 'bug' });
    expect(a.id).toBe(b.id);
  });

  it('deleteLabel removes the label and join rows', () => {
    const label = createLabel({ name: 'temp' });
    const task = createTask({ title: 'T' });
    setTaskLabels(task.id, ['temp']);
    expect(getTaskLabels(task.id)).toContain('temp');
    expect(deleteLabel(label.id)).toBe(true);
    expect(getTaskLabels(task.id)).not.toContain('temp');
    expect(listLabels().some(l => l.name === 'temp')).toBe(false);
  });
});

describe('setTaskLabels', () => {
  it('upserts unknown label names automatically', () => {
    const task = createTask({ title: 'T' });
    setTaskLabels(task.id, ['brand-new']);
    expect(getLabelByName('brand-new')).not.toBeNull();
    expect(getTaskLabels(task.id)).toEqual(['brand-new']);
  });

  it('replaces previous labels rather than appending', () => {
    const task = createTask({ title: 'T' });
    setTaskLabels(task.id, ['bug', 'urgent']);
    expect(getTaskLabels(task.id).sort()).toEqual(['bug', 'urgent']);
    setTaskLabels(task.id, ['feature']);
    expect(getTaskLabels(task.id)).toEqual(['feature']);
  });

  it('handles empty array (clears all labels)', () => {
    const task = createTask({ title: 'T' });
    setTaskLabels(task.id, ['bug']);
    setTaskLabels(task.id, []);
    expect(getTaskLabels(task.id)).toEqual([]);
  });

  it('dedupes input names', () => {
    const task = createTask({ title: 'T' });
    setTaskLabels(task.id, ['bug', 'bug', 'bug']);
    expect(getTaskLabels(task.id)).toEqual(['bug']);
  });

  it('getLabelsForTasks returns map for many tasks at once', () => {
    const a = createTask({ title: 'A' });
    const b = createTask({ title: 'B' });
    setTaskLabels(a.id, ['bug']);
    setTaskLabels(b.id, ['feature', 'urgent']);
    const map = getLabelsForTasks([a.id, b.id]);
    expect(map[a.id]).toEqual(['bug']);
    expect(map[b.id].sort()).toEqual(['feature', 'urgent']);
  });
});
