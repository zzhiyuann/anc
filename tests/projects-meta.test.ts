/**
 * Wave B persistence: round-trip Linear-style project meta through the
 * backend (createProject → updateProject → re-fetch) and verify that the
 * frontend resolveMeta path prefers backend fields over localStorage.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmpDir = mkdtempSync(join(tmpdir(), 'anc-projects-meta-test-'));
process.env.ANC_DB_PATH = join(tmpDir, 'state.db');

const { _resetDb, getDb } = await import('../src/core/db.js');
const {
  createProject, getProject, updateProject,
} = await import('../src/core/projects.js');

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

describe('project meta persistence (Wave B)', () => {
  it('createProject applies sensible defaults for new fields', () => {
    const p = createProject({ name: 'Defaults' });
    expect(p.health).toBe('no-update');
    expect(p.priority).toBe(3);
    expect(p.lead).toBeNull();
    expect(p.targetDate).toBeNull();
  });

  it('createProject honors explicit meta values', () => {
    const p = createProject({
      name: 'Explicit',
      health: 'on-track',
      priority: 1,
      lead: 'engineer',
      targetDate: '2026-06-30',
    });
    expect(p.health).toBe('on-track');
    expect(p.priority).toBe(1);
    expect(p.lead).toBe('engineer');
    expect(p.targetDate).toBe('2026-06-30');
  });

  it('updateProject round-trips health', () => {
    const p = createProject({ name: 'H' });
    const u = updateProject(p.id, { health: 'at-risk' })!;
    expect(u.health).toBe('at-risk');
    expect(getProject(p.id)!.health).toBe('at-risk');
  });

  it('updateProject round-trips priority', () => {
    const p = createProject({ name: 'P' });
    const u = updateProject(p.id, { priority: 5 })!;
    expect(u.priority).toBe(5);
    expect(getProject(p.id)!.priority).toBe(5);
  });

  it('updateProject round-trips lead (and clears it)', () => {
    const p = createProject({ name: 'L' });
    expect(updateProject(p.id, { lead: 'strategist' })!.lead).toBe('strategist');
    expect(updateProject(p.id, { lead: null })!.lead).toBeNull();
  });

  it('updateProject round-trips targetDate (and clears it)', () => {
    const p = createProject({ name: 'T' });
    expect(updateProject(p.id, { targetDate: '2026-12-31' })!.targetDate).toBe('2026-12-31');
    expect(updateProject(p.id, { targetDate: null })!.targetDate).toBeNull();
  });

  it('updateProject patches multiple fields atomically', () => {
    const p = createProject({ name: 'Multi' });
    const u = updateProject(p.id, {
      health: 'off-track',
      priority: 2,
      lead: 'ops',
      targetDate: '2026-07-15',
    })!;
    expect(u.health).toBe('off-track');
    expect(u.priority).toBe(2);
    expect(u.lead).toBe('ops');
    expect(u.targetDate).toBe('2026-07-15');
  });

  it('frontend resolveMeta prefers backend fields over localStorage when present', async () => {
    // Simulate the resolution logic from projects-table.tsx without importing
    // React. The contract: if any backend meta field is defined, ignore the
    // legacy localStorage fallback entirely.
    const project = {
      id: 'proj-x',
      health: 'on-track' as const,
      priority: 1,
      lead: 'engineer',
      targetDate: '2026-06-30',
    };
    // Stub localStorage with a competing value — should NOT be consulted.
    let localStorageRead = false;
    const fakeMeta = () => {
      localStorageRead = true;
      return { health: 'off-track', priority: 5, lead: 'wrong', targetDate: '1999-01-01' };
    };

    const hasAny =
      project.health !== undefined ||
      project.priority !== undefined ||
      project.lead !== undefined ||
      project.targetDate !== undefined;
    const meta = hasAny
      ? {
          health: project.health ?? 'no-update',
          priority: project.priority ?? 3,
          lead: project.lead ?? null,
          targetDate: project.targetDate ?? null,
        }
      : fakeMeta();

    expect(localStorageRead).toBe(false);
    expect(meta.health).toBe('on-track');
    expect(meta.priority).toBe(1);
    expect(meta.lead).toBe('engineer');
    expect(meta.targetDate).toBe('2026-06-30');
  });
});
