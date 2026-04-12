import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmpDir = mkdtempSync(join(tmpdir(), 'anc-projects-test-'));
process.env.ANC_DB_PATH = join(tmpDir, 'state.db');

const { _resetDb, getDb } = await import('../src/core/db.js');
const {
  createProject, getProject, listProjects, updateProject,
  archiveProject, getProjectStats,
} = await import('../src/core/projects.js');
const { createTask } = await import('../src/core/tasks.js');
const { attachEventLogger } = await import('../src/core/events.js');
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

describe('projects CRUD', () => {
  it('createProject with slug id', () => {
    const p = createProject({ name: 'Marketing Q2' });
    expect(p.id).toBe('proj-marketing-q2');
    expect(p.name).toBe('Marketing Q2');
    expect(p.color).toBe('#3b82f6');
    expect(p.state).toBe('active');
  });

  it('createProject collision appends hash', () => {
    createProject({ name: 'Dup' });
    const p2 = createProject({ name: 'Dup' });
    expect(p2.id).not.toBe('proj-dup');
    expect(p2.id.startsWith('proj-dup-')).toBe(true);
  });

  it('getProject returns null for unknown', () => {
    expect(getProject('nope')).toBeNull();
  });

  it('listProjects includes seeded system project', () => {
    const list = listProjects();
    expect(list.some(p => p.id === 'system')).toBe(true);
  });

  it('listProjects filters by state', () => {
    createProject({ name: 'A', state: 'archived' });
    expect(listProjects({ state: 'archived' }).length).toBe(1);
  });

  it('updateProject patches name/color', () => {
    const p = createProject({ name: 'A' });
    const u = updateProject(p.id, { name: 'B', color: '#fff' })!;
    expect(u.name).toBe('B');
    expect(u.color).toBe('#fff');
  });

  it('archiveProject sets archived state + archived_at', () => {
    const p = createProject({ name: 'Arch' });
    archiveProject(p.id);
    const after = getProject(p.id)!;
    expect(after.state).toBe('archived');
    expect(after.archivedAt).toBeGreaterThan(0);
  });

  it('getProjectStats counts by task state', () => {
    const p = createProject({ name: 'Stats' });
    createTask({ title: 'a', projectId: p.id, state: 'todo' });
    createTask({ title: 'b', projectId: p.id, state: 'running' });
    createTask({ title: 'c', projectId: p.id, state: 'done' });
    createTask({ title: 'd', projectId: p.id, state: 'done' });
    const stats = getProjectStats(p.id);
    expect(stats.total).toBe(4);
    expect(stats.queued).toBe(1);
    expect(stats.running).toBe(1);
    expect(stats.done).toBe(2);
  });
});

describe('event logger', () => {
  it('writes task_events row when task:created fires', async () => {
    attachEventLogger(bus as unknown as { on: (ev: string, l: (d: unknown) => void) => unknown });
    const t = createTask({ title: 'Ev' });
    await bus.emit('task:created', { taskId: t.id, projectId: null, title: 'Ev', source: 'dashboard' });
    const rows = getDb().prepare('SELECT * FROM task_events WHERE task_id = ?').all(t.id) as Array<Record<string, unknown>>;
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0].type).toBe('task:created');
  });

  it('resolves task_id from issueKey for agent:spawned', async () => {
    attachEventLogger(bus as unknown as { on: (ev: string, l: (d: unknown) => void) => unknown });
    const t = createTask({ title: 'Eng', linearIssueKey: 'RYA-7' });
    await bus.emit('agent:spawned', { role: 'engineer', issueKey: 'RYA-7', tmuxSession: 'anc-engineer-RYA-7' });
    const rows = getDb().prepare('SELECT * FROM task_events WHERE task_id = ?').all(t.id) as Array<Record<string, unknown>>;
    expect(rows.some(r => r.type === 'agent:spawned')).toBe(true);
  });

  it('drops events with no resolvable task', async () => {
    attachEventLogger(bus as unknown as { on: (ev: string, l: (d: unknown) => void) => unknown });
    await bus.emit('agent:spawned', { role: 'engineer', issueKey: 'UNKNOWN-X', tmuxSession: 'x' });
    const rows = getDb().prepare('SELECT * FROM task_events').all() as Array<Record<string, unknown>>;
    // No row for the unknown issue
    expect(rows.some(r => (r.task_id as string) === 'UNKNOWN-X')).toBe(false);
  });
});
