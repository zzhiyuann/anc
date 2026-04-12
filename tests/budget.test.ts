/**
 * Phase 1 — Budget Tracker integration tests.
 * Tests canSpend(), recordSpend(), getSummary(), and alert events.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { bus } from '../src/bus.js';
import { getDb } from '../src/core/db.js';
import { setFileLogging } from '../src/core/logger.js';

// Must mock the config before importing budget module
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: vi.fn((path: string) => {
      // Return false for budget.yaml to force defaults — we override via reloadConfig()
      if (typeof path === 'string' && path.endsWith('budget.yaml')) return false;
      return actual.existsSync(path);
    }),
    readFileSync: actual.readFileSync,
  };
});

import { canSpend, recordSpend, getSummary, reloadConfig } from '../src/core/budget.js';

setFileLogging(false);

function clearBudgetLog() {
  getDb().prepare('DELETE FROM budget_log').run();
}

beforeEach(() => {
  reloadConfig();
  clearBudgetLog();
  vi.clearAllMocks();
});

afterEach(() => {
  bus.removeAllListeners('system:budget-alert');
});

// --- canSpend ---

describe('Budget — canSpend', () => {
  it('returns allowed:true when under limits', () => {
    const result = canSpend('engineer', 5.00);
    expect(result.allowed).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it('returns allowed:false with reason when daily limit exceeded', () => {
    // Record spend to fill up the daily limit (default $50)
    recordSpend('engineer', 'ANC-1', 100000, 48.00);
    const result = canSpend('engineer', 5.00);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Daily limit');
  });

  it('returns allowed:false when exactly at daily limit', () => {
    recordSpend('engineer', 'ANC-1', 100000, 50.00);
    const result = canSpend('engineer', 0.01);
    expect(result.allowed).toBe(false);
  });

  it('allows spend up to (but not exceeding) the daily limit', () => {
    recordSpend('engineer', 'ANC-1', 100000, 45.00);
    const result = canSpend('engineer', 5.00);
    expect(result.allowed).toBe(true); // 45 + 5 = 50, exactly at limit
  });
});

// --- recordSpend ---

describe('Budget — recordSpend', () => {
  it('persists spend to database', () => {
    recordSpend('engineer', 'ANC-1', 50000, 2.50);
    const summary = getSummary();
    expect(summary.today.spent).toBe(2.50);
  });

  it('multiple spends accumulate', () => {
    recordSpend('engineer', 'ANC-1', 50000, 2.50);
    recordSpend('engineer', 'ANC-2', 30000, 1.50);
    const summary = getSummary();
    expect(summary.today.spent).toBe(4.00);
  });

  it('emits budget-alert when daily spend exceeds alertAt threshold', () => {
    const handler = vi.fn();
    bus.on('system:budget-alert', handler);

    // Default alertAt is 0.80 of $50 = $40
    recordSpend('engineer', 'ANC-1', 500000, 41.00);

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        spent: expect.any(Number),
        limit: 50,
        percent: expect.any(Number),
      })
    );
  });

  it('does NOT emit alert when below threshold', () => {
    const handler = vi.fn();
    bus.on('system:budget-alert', handler);

    recordSpend('engineer', 'ANC-1', 50000, 5.00); // well below 80%

    // Filter only daily alerts (no agentRole property)
    const dailyAlerts = handler.mock.calls.filter(
      (call: unknown[]) => !(call[0] as Record<string, unknown>).agentRole
    );
    expect(dailyAlerts).toHaveLength(0);
  });
});

// --- getSummary ---

describe('Budget — getSummary', () => {
  it('returns correct today spend and limit', () => {
    recordSpend('engineer', 'ANC-1', 50000, 10.00);
    const summary = getSummary();
    expect(summary.today.spent).toBe(10.00);
    expect(summary.today.limit).toBe(50); // default
  });

  it('returns per-agent breakdown', () => {
    recordSpend('engineer', 'ANC-1', 50000, 10.00);
    recordSpend('ops', 'ANC-2', 20000, 3.00);
    const summary = getSummary();

    // Both agents should appear
    expect(summary.perAgent['engineer']).toBeDefined();
    expect(summary.perAgent['engineer'].spent).toBe(10.00);
    expect(summary.perAgent['ops']).toBeDefined();
    expect(summary.perAgent['ops'].spent).toBe(3.00);
  });

  it('returns empty summary when no spend recorded', () => {
    const summary = getSummary();
    expect(summary.today.spent).toBe(0);
    expect(summary.history).toHaveLength(0);
  });

  it('returns history array', () => {
    recordSpend('engineer', 'ANC-1', 50000, 10.00);
    const summary = getSummary();
    expect(Array.isArray(summary.history)).toBe(true);
  });
});

// --- Multiple agents tracked independently ---

describe('Budget — multi-agent independence', () => {
  it('tracks agents independently', () => {
    recordSpend('engineer', 'ANC-1', 50000, 20.00);
    recordSpend('ops', 'ANC-2', 20000, 3.00);
    recordSpend('strategist', 'ANC-3', 40000, 8.00);

    const summary = getSummary();
    expect(summary.perAgent['engineer'].spent).toBe(20.00);
    expect(summary.perAgent['ops'].spent).toBe(3.00);
    expect(summary.perAgent['strategist'].spent).toBe(8.00);

    // Total daily spend is sum
    expect(summary.today.spent).toBe(31.00);
  });

  it('canSpend checks daily limit across all agents', () => {
    recordSpend('engineer', 'ANC-1', 100000, 25.00);
    recordSpend('strategist', 'ANC-2', 100000, 24.00);

    // 49 total, trying to add 2 should fail (daily limit = 50)
    const result = canSpend('ops', 2.00);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Daily limit');
  });
});
