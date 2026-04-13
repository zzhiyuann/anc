import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Each test runs the review module from a temp cwd so writes to
// config/review.yaml don't pollute the repo.
const tmpDir = mkdtempSync(join(tmpdir(), 'anc-review-test-'));
const originalCwd = process.cwd();
process.chdir(tmpDir);
mkdirSync(join(tmpDir, 'config'), { recursive: true });

const review = await import('../src/core/review.js');
const {
  loadReviewConfig, saveReviewConfig, resetReviewConfig,
  resolveReviewLevel, applyHandoffPolicy, invalidateReviewCache,
  mergeReviewConfig, normalizeConfig, HARDCODED_DEFAULT,
} = review;

beforeEach(() => {
  invalidateReviewCache();
  // Wipe config file so each test starts from defaults.
  try { rmSync(join(tmpDir, 'config', 'review.yaml'), { force: true }); } catch { /**/ }
});

afterAll(() => {
  process.chdir(originalCwd);
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /**/ }
});

describe('loadReviewConfig', () => {
  it('returns hardcoded defaults when file is missing', () => {
    const cfg = loadReviewConfig();
    expect(cfg.default).toBe('normal');
    expect(cfg.roles.engineer).toBe('normal');
    expect(cfg.roles.ops).toBe('lax');
    expect(cfg.roles['ceo-office']).toBe('autonomous');
  });

  it('caches results across calls', () => {
    const a = loadReviewConfig();
    const b = loadReviewConfig();
    expect(a).toBe(b);
  });

  it('reloads after invalidate', () => {
    const a = loadReviewConfig();
    invalidateReviewCache();
    const b = loadReviewConfig();
    expect(a).not.toBe(b);
  });
});

describe('normalizeConfig', () => {
  it('drops invalid levels', () => {
    const cfg = normalizeConfig({
      default: 'banana',
      roles: { eng: 'strict', bad: 'huh' },
    });
    expect(cfg.default).toBe('normal'); // falls back to hardcoded
    expect(cfg.roles.eng).toBe('strict');
    expect(cfg.roles.bad).toBeUndefined();
  });
});

describe('mergeReviewConfig', () => {
  it('merges roles and removes nulls', () => {
    const base = { default: 'normal' as const, roles: { a: 'strict' as const, b: 'lax' as const }, projects: {}, overrides: {} };
    const merged = mergeReviewConfig(base, { roles: { a: null, c: 'autonomous' } });
    expect(merged.roles).toEqual({ b: 'lax', c: 'autonomous' });
  });

  it('rejects invalid level in patch', () => {
    expect(() => mergeReviewConfig(HARDCODED_DEFAULT, { default: 'wat' as never })).toThrow();
  });
});

describe('saveReviewConfig + reset', () => {
  it('persists and reloads', () => {
    saveReviewConfig({ roles: { engineer: 'strict' } });
    const cfg = loadReviewConfig();
    expect(cfg.roles.engineer).toBe('strict');
  });

  it('reset wipes back to hardcoded', () => {
    saveReviewConfig({ default: 'strict', overrides: { 'task-1': 'lax' } });
    const fresh = resetReviewConfig();
    expect(fresh.default).toBe('normal');
    expect(fresh.overrides).toEqual({});
    expect(loadReviewConfig().default).toBe('normal');
  });
});

describe('resolveReviewLevel — precedence', () => {
  it('uses default when nothing matches', () => {
    expect(resolveReviewLevel(null, null, null)).toBe('normal');
  });

  it('role beats default', () => {
    expect(resolveReviewLevel(null, 'ops', null)).toBe('lax');
  });

  it('project beats role', () => {
    saveReviewConfig({ projects: { 'proj-x': 'autonomous' } });
    expect(resolveReviewLevel(null, 'engineer', 'proj-x')).toBe('autonomous');
  });

  it('task override beats project', () => {
    saveReviewConfig({
      projects: { 'proj-x': 'autonomous' },
      overrides: { 'task-42': 'strict' },
    });
    expect(resolveReviewLevel('task-42', 'engineer', 'proj-x')).toBe('strict');
  });

  it('unknown role falls through to default', () => {
    expect(resolveReviewLevel(null, 'mystery', null)).toBe('normal');
  });
});

describe('applyHandoffPolicy — decision table', () => {
  const baseTask = { id: 'task-1', projectId: null };

  it('strict → review + notify', () => {
    saveReviewConfig({ overrides: { 'task-1': 'strict' } });
    expect(applyHandoffPolicy(baseTask, { role: 'engineer' })).toEqual({
      nextState: 'review', notify: true,
    });
  });

  it('normal → review + notify', () => {
    saveReviewConfig({ overrides: { 'task-1': 'normal' } });
    expect(applyHandoffPolicy(baseTask, { role: 'engineer' })).toEqual({
      nextState: 'review', notify: true,
    });
  });

  it('lax → done + notify', () => {
    saveReviewConfig({ overrides: { 'task-1': 'lax' } });
    expect(applyHandoffPolicy(baseTask, { role: 'ops' })).toEqual({
      nextState: 'done', notify: true,
    });
  });

  it('autonomous → done + silent', () => {
    saveReviewConfig({ overrides: { 'task-1': 'autonomous' } });
    expect(applyHandoffPolicy(baseTask, { role: 'ceo-office' })).toEqual({
      nextState: 'done', notify: false,
    });
  });

  it('peer-review → review + silent + spawnPeer when picker returns one', () => {
    saveReviewConfig({ overrides: { 'task-1': 'peer-review' } });
    const decision = applyHandoffPolicy(baseTask, {
      role: 'engineer',
      pickPeer: () => 'engineer-2',
    });
    expect(decision).toEqual({
      nextState: 'review', notify: false, spawnPeer: 'engineer-2',
    });
  });

  it('peer-review without picker omits spawnPeer', () => {
    saveReviewConfig({ overrides: { 'task-1': 'peer-review' } });
    const decision = applyHandoffPolicy(baseTask, { role: 'engineer' });
    expect(decision).toEqual({ nextState: 'review', notify: false });
  });
});
