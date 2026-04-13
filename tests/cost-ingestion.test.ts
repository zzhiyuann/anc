/**
 * Cost ingestion tests — verify that token usage extracted from a Claude Code
 * transcript is correctly priced and written to budget_log via the hook
 * handler's Stop/SessionEnd path.
 */

import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Force budget.yaml lookups to fall through to defaults so we never write to
// the user's real config during test runs.
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

import {
  computeCost,
  totalTokens,
  getPricing,
  MODEL_PRICING,
} from '../src/core/pricing.js';
import {
  parseTranscriptUsage,
  ingestSessionCost,
  processHookEvent,
} from '../src/api/hook-handler.js';
import { _setDbForTesting } from '../src/core/db.js';
import { reloadConfig } from '../src/core/budget.js';

let testDb: Database.Database;
let tmpDir: string;

function freshDb(): Database.Database {
  const d = new Database(':memory:');
  d.exec(`
    CREATE TABLE task_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      role TEXT NOT NULL,
      type TEXT NOT NULL,
      payload TEXT NOT NULL,
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

beforeEach(() => {
  testDb = freshDb();
  _setDbForTesting(testDb);
  tmpDir = mkdtempSync(join(tmpdir(), 'anc-cost-test-'));
  reloadConfig();
});

afterAll(() => {
  _setDbForTesting(null);
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /**/ }
});

// --- computeCost / pricing ---

describe('computeCost', () => {
  it('returns 0 for zero usage', () => {
    expect(computeCost('claude-sonnet-4-5', { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })).toBe(0);
  });

  it('prices Sonnet correctly', () => {
    const cost = computeCost('claude-sonnet-4-5', {
      input: 1_000_000, output: 1_000_000, cacheRead: 0, cacheWrite: 0,
    });
    // 1M input @ $3 + 1M output @ $15 = $18
    expect(cost).toBeCloseTo(18.0, 5);
  });

  it('prices Opus correctly', () => {
    const cost = computeCost('claude-opus-4-6', {
      input: 1_000_000, output: 1_000_000, cacheRead: 0, cacheWrite: 0,
    });
    // 1M input @ $15 + 1M output @ $75 = $90
    expect(cost).toBeCloseTo(90.0, 5);
  });

  it('prices Haiku correctly', () => {
    const cost = computeCost('claude-haiku-4-5', {
      input: 2_000_000, output: 1_000_000, cacheRead: 0, cacheWrite: 0,
    });
    // 2M @ $1 + 1M @ $5 = $7
    expect(cost).toBeCloseTo(7.0, 5);
  });

  it('handles cache reads/writes', () => {
    const cost = computeCost('claude-sonnet-4-5', {
      input: 0, output: 0, cacheRead: 1_000_000, cacheWrite: 1_000_000,
    });
    // 1M cache_read @ $0.30 + 1M cache_write @ $3.75 = $4.05
    expect(cost).toBeCloseTo(4.05, 5);
  });

  it('falls back to Sonnet for unknown models', () => {
    expect(getPricing('totally-fake-model')).toEqual(MODEL_PRICING['claude-sonnet-4-5']);
  });

  it('matches by prefix for versioned model ids', () => {
    expect(getPricing('claude-opus-4-6-20251022')).toEqual(MODEL_PRICING['claude-opus-4-6']);
  });

  it('totalTokens sums all categories', () => {
    expect(totalTokens({ input: 10, output: 20, cacheRead: 5, cacheWrite: 3 })).toBe(38);
  });
});

// --- parseTranscriptUsage ---

function writeTranscript(name: string, lines: object[]): string {
  const path = join(tmpDir, name);
  writeFileSync(path, lines.map(l => JSON.stringify(l)).join('\n') + '\n', 'utf8');
  return path;
}

describe('parseTranscriptUsage', () => {
  it('sums usage across multiple assistant messages', () => {
    const path = writeTranscript('t1.jsonl', [
      { type: 'user', message: { role: 'user', content: 'hi' } },
      {
        type: 'assistant',
        message: {
          role: 'assistant',
          model: 'claude-sonnet-4-5',
          usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 20, cache_creation_input_tokens: 10 },
        },
      },
      {
        type: 'assistant',
        message: {
          role: 'assistant',
          model: 'claude-sonnet-4-5',
          usage: { input_tokens: 200, output_tokens: 80 },
        },
      },
    ]);
    const result = parseTranscriptUsage(path);
    expect(result).not.toBeNull();
    expect(result!.usage.input).toBe(300);
    expect(result!.usage.output).toBe(130);
    expect(result!.usage.cacheRead).toBe(20);
    expect(result!.usage.cacheWrite).toBe(10);
    expect(result!.model).toBe('claude-sonnet-4-5');
  });

  it('returns null when no assistant usage is present', () => {
    const path = writeTranscript('t2.jsonl', [
      { type: 'user', message: { role: 'user', content: 'hi' } },
    ]);
    expect(parseTranscriptUsage(path)).toBeNull();
  });

  it('skips malformed JSON lines gracefully', () => {
    const path = join(tmpDir, 't3.jsonl');
    writeFileSync(path, 'not json\n' +
      JSON.stringify({
        type: 'assistant',
        message: { role: 'assistant', model: 'claude-opus-4-6', usage: { input_tokens: 7, output_tokens: 3 } },
      }) + '\n', 'utf8');
    const result = parseTranscriptUsage(path);
    expect(result!.usage.input).toBe(7);
    expect(result!.usage.output).toBe(3);
  });
});

// --- ingestSessionCost end-to-end ---

describe('ingestSessionCost', () => {
  it('writes a budget_log row from a Stop event with transcript', () => {
    const transcriptPath = writeTranscript('stop.jsonl', [
      {
        type: 'assistant',
        message: {
          role: 'assistant',
          model: 'claude-sonnet-4-5',
          usage: { input_tokens: 1_000_000, output_tokens: 500_000 },
        },
      },
    ]);

    // Seed sessions table so resolveIssueKey maps task_id → issue_key
    testDb.prepare(
      'INSERT INTO sessions (issue_key, role, tmux_session, spawned_at, task_id) VALUES (?, ?, ?, ?, ?)'
    ).run('ANC-42', 'engineer', 'tmux-x', Date.now(), 'task-uuid-1');

    const result = ingestSessionCost('task-uuid-1', 'engineer', {
      hook_event_name: 'Stop',
      transcript_path: transcriptPath,
    });

    expect(result).not.toBeNull();
    // 1M input @ $3 + 0.5M output @ $15 = $3 + $7.5 = $10.50
    expect(result!.cost).toBeCloseTo(10.5, 4);
    expect(result!.tokens).toBe(1_500_000);

    const rows = testDb.prepare('SELECT * FROM budget_log').all() as Array<{
      agent_role: string; issue_key: string; tokens: number; cost_usd: number;
    }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].agent_role).toBe('engineer');
    expect(rows[0].issue_key).toBe('ANC-42');
    expect(rows[0].tokens).toBe(1_500_000);
    expect(rows[0].cost_usd).toBeCloseTo(10.5, 4);
  });

  it('returns null when transcript_path is missing', () => {
    const result = ingestSessionCost('task-x', 'engineer', { hook_event_name: 'Stop' });
    expect(result).toBeNull();
    expect(testDb.prepare('SELECT COUNT(*) AS n FROM budget_log').get()).toEqual({ n: 0 });
  });

  it('returns null when transcript file does not exist', () => {
    const result = ingestSessionCost('task-x', 'engineer', {
      hook_event_name: 'Stop',
      transcript_path: join(tmpDir, 'does-not-exist.jsonl'),
    });
    expect(result).toBeNull();
  });

  it('processHookEvent triggers cost ingestion on Stop', () => {
    const transcriptPath = writeTranscript('stop2.jsonl', [
      {
        type: 'assistant',
        message: {
          role: 'assistant',
          model: 'claude-sonnet-4-5',
          usage: { input_tokens: 100_000, output_tokens: 50_000 },
        },
      },
    ]);
    testDb.prepare(
      'INSERT INTO sessions (issue_key, role, tmux_session, spawned_at, task_id) VALUES (?, ?, ?, ?, ?)'
    ).run('ANC-7', 'engineer', 'tmux-y', Date.now(), 'task-uuid-2');

    const res = processHookEvent('task-uuid-2', 'engineer', {
      hook_event_name: 'Stop',
      transcript_path: transcriptPath,
    });
    expect(res.ok).toBe(true);

    const row = testDb.prepare('SELECT * FROM budget_log WHERE issue_key = ?').get('ANC-7') as
      | { tokens: number; cost_usd: number } | undefined;
    expect(row).toBeTruthy();
    expect(row!.tokens).toBe(150_000);
    // 0.1M @ $3 + 0.05M @ $15 = 0.30 + 0.75 = 1.05
    expect(row!.cost_usd).toBeCloseTo(1.05, 4);
  });
});
