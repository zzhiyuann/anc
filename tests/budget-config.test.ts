/**
 * GUI budget-config tests — saveConfig (write + cache invalidate),
 * resetTodayBudget, and isDisabled() env-var reflection.
 *
 * Uses a dedicated temp working directory so we can write a real
 * config/budget.yaml file without polluting the repo. We avoid the
 * fs-mocking strategy used in budget.test.ts because saveConfig must
 * actually touch the disk.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { parse as parseYaml } from 'yaml';
import { getDb } from '../src/core/db.js';
import { setFileLogging } from '../src/core/logger.js';
import {
  saveConfig,
  resetTodayBudget,
  isDisabled,
  getConfig,
  reloadConfig,
  recordSpend,
} from '../src/core/budget.js';

setFileLogging(false);

let tmpDir: string;
let originalCwd: string;
const originalEnv = process.env.ANC_BUDGET_DISABLED;

function clearBudgetLog() {
  getDb().prepare('DELETE FROM budget_log').run();
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'anc-budget-config-'));
  mkdirSync(join(tmpDir, 'config'));
  originalCwd = process.cwd();
  process.chdir(tmpDir);

  // Seed a baseline budget.yaml so loadConfig has something concrete to read.
  writeFileSync(
    join(tmpDir, 'config', 'budget.yaml'),
    'daily:\n  limit: 50\n  alertAt: 0.8\nagents:\n  engineer:\n    limit: 30\n    alertAt: 0.85\n',
    'utf-8',
  );

  reloadConfig();
  clearBudgetLog();
  delete process.env.ANC_BUDGET_DISABLED;
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(tmpDir, { recursive: true, force: true });
  if (originalEnv === undefined) delete process.env.ANC_BUDGET_DISABLED;
  else process.env.ANC_BUDGET_DISABLED = originalEnv;
  reloadConfig();
});

// --- saveConfig ---

describe('Budget — saveConfig', () => {
  it('writes daily updates to YAML and reflects them in getConfig', () => {
    const updated = saveConfig({ daily: { limit: 75, alertAt: 0.9 } });
    expect(updated.daily.limit).toBe(75);
    expect(updated.daily.alertAt).toBe(0.9);

    const onDisk = parseYaml(readFileSync(join(tmpDir, 'config', 'budget.yaml'), 'utf-8'));
    expect(onDisk.daily.limit).toBe(75);
    expect(onDisk.daily.alertAt).toBe(0.9);
  });

  it('merges per-agent patches without dropping other agents', () => {
    const updated = saveConfig({ agents: { engineer: { limit: 99 } } });
    expect(updated.agents.engineer.limit).toBe(99);
    expect(updated.agents.engineer.alertAt).toBe(0.85);
  });

  it('adds a new per-agent entry', () => {
    const updated = saveConfig({ agents: { ops: { limit: 12, alertAt: 0.7 } } });
    expect(updated.agents.ops).toEqual({ limit: 12, alertAt: 0.7 });
  });

  it('deletes an agent entry when value is null', () => {
    const updated = saveConfig({ agents: { engineer: null } });
    expect(updated.agents.engineer).toBeUndefined();

    const onDisk = parseYaml(readFileSync(join(tmpDir, 'config', 'budget.yaml'), 'utf-8'));
    expect(onDisk.agents?.engineer).toBeUndefined();
  });

  it('invalidates the cache so subsequent loadConfig returns fresh values', () => {
    expect(getConfig().daily.limit).toBe(50);
    saveConfig({ daily: { limit: 200 } });
    expect(getConfig().daily.limit).toBe(200);
  });
});

// --- resetTodayBudget ---

describe('Budget — resetTodayBudget', () => {
  it('deletes today rows but preserves rows from yesterday', () => {
    // Insert a row dated yesterday directly.
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(12, 0, 0, 0);
    getDb().prepare(
      'INSERT INTO budget_log (agent_role, issue_key, tokens, cost_usd, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run('engineer', 'OLD-1', 1000, 1.23, yesterday.getTime());

    // Today row via recordSpend.
    recordSpend('engineer', 'NEW-1', 500, 4.56);

    resetTodayBudget();

    const rows = getDb().prepare('SELECT issue_key FROM budget_log').all() as Array<{ issue_key: string }>;
    expect(rows.map(r => r.issue_key)).toEqual(['OLD-1']);
  });
});

// --- isDisabled ---

describe('Budget — isDisabled', () => {
  it('returns false when env var is unset', () => {
    delete process.env.ANC_BUDGET_DISABLED;
    expect(isDisabled()).toBe(false);
  });

  it('returns true when env var is "true"', () => {
    process.env.ANC_BUDGET_DISABLED = 'true';
    expect(isDisabled()).toBe(true);
  });

  it('returns true when env var is "1"', () => {
    process.env.ANC_BUDGET_DISABLED = '1';
    expect(isDisabled()).toBe(true);
  });

  it('returns false for any other value', () => {
    process.env.ANC_BUDGET_DISABLED = 'no';
    expect(isDisabled()).toBe(false);
  });
});

// Mark file existence check to make sure tmpDir setup actually wrote.
describe('Budget config test bootstrap', () => {
  it('seed file exists', () => {
    expect(existsSync(join(tmpDir, 'config', 'budget.yaml'))).toBe(true);
  });
});
