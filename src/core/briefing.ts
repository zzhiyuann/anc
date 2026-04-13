/**
 * Daily briefing generator — synthesises a one-screen morning summary from
 * real backend state (tasks, budget log, events). Cached for one hour to
 * avoid recompute storms when the dashboard polls aggressively.
 */

import { getDb } from './db.js';
import { getSummary } from './budget.js';
import { createLogger } from './logger.js';

const log = createLogger('briefing');

export interface DailyBriefing {
  generatedAt: number;
  yesterdayCompletions: string[];
  todayQueue: string[];
  costBurn: { spentUsd: number; budgetUsd: number };
  wins: string[];
  risks: string[];
}

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
let cache: { briefing: DailyBriefing; expiresAt: number } | null = null;

/** Test helper: clear the in-memory cache. */
export function _resetBriefingCache(): void {
  cache = null;
}

interface TaskRow {
  title: string;
  handoff_summary: string | null;
  completed_at: number | null;
}

export function generateBriefing(opts?: { force?: boolean }): DailyBriefing {
  if (!opts?.force && cache && cache.expiresAt > Date.now()) return cache.briefing;

  const db = getDb();
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;

  // Local-day boundaries
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const startOfTodayMs = startOfToday.getTime();
  const startOfYesterdayMs = startOfTodayMs - dayMs;

  // 1. Yesterday's completions
  // SELECT title, handoff_summary FROM tasks
  //   WHERE state='done' AND completed_at BETWEEN ? AND ?
  //   ORDER BY completed_at DESC LIMIT 5
  let yesterdayCompletions: string[] = [];
  let wins: string[] = [];
  try {
    const rows = db.prepare(
      `SELECT title, handoff_summary, completed_at
         FROM tasks
        WHERE state = 'done'
          AND completed_at IS NOT NULL
          AND completed_at >= ?
          AND completed_at < ?
        ORDER BY completed_at DESC
        LIMIT 5`
    ).all(startOfYesterdayMs, startOfTodayMs) as TaskRow[];
    yesterdayCompletions = rows.map(r => r.title);
    wins = rows.map(r =>
      r.handoff_summary && r.handoff_summary.trim().length > 0
        ? `${r.title} — ${r.handoff_summary.trim().split('\n')[0].slice(0, 200)}`
        : r.title,
    );
  } catch (err) {
    log.warn(`yesterday completions query failed: ${(err as Error).message}`);
  }

  // 2. Today's queue (top 5 pending tasks by priority then createdAt)
  // SELECT title FROM tasks WHERE state IN ('todo','running') ORDER BY priority ASC, created_at ASC LIMIT 5
  let todayQueue: string[] = [];
  try {
    const rows = db.prepare(
      `SELECT title FROM tasks
        WHERE state IN ('todo', 'running')
        ORDER BY priority ASC, created_at ASC
        LIMIT 5`
    ).all() as Array<{ title: string }>;
    todayQueue = rows.map(r => r.title);
  } catch (err) {
    log.warn(`today queue query failed: ${(err as Error).message}`);
  }

  // 3. Cost burn — delegate to budget.getSummary()
  let costBurn = { spentUsd: 0, budgetUsd: 0 };
  try {
    const summary = getSummary();
    costBurn = {
      spentUsd: summary.today.spent,
      budgetUsd: summary.today.limit,
    };
  } catch (err) {
    log.warn(`budget summary failed: ${(err as Error).message}`);
  }

  // 4. Risks — failed tasks in last 24h + budget alerts in last 24h
  // SELECT title FROM tasks WHERE state='failed' AND completed_at >= ? LIMIT 5
  // SELECT detail FROM events WHERE event_type='system:budget-alert' AND created_at >= ? LIMIT 5
  const risks: string[] = [];
  try {
    const failed = db.prepare(
      `SELECT title FROM tasks
        WHERE state = 'failed'
          AND completed_at IS NOT NULL
          AND completed_at >= ?
        ORDER BY completed_at DESC
        LIMIT 5`
    ).all(now - dayMs) as Array<{ title: string }>;
    for (const f of failed) risks.push(`Failed: ${f.title}`);
  } catch (err) {
    log.warn(`failed tasks query failed: ${(err as Error).message}`);
  }

  try {
    // events.created_at is a TEXT datetime — compare against an ISO string
    // for the last 24h cutoff.
    const cutoffIso = new Date(now - dayMs).toISOString().replace('T', ' ').slice(0, 19);
    const alerts = db.prepare(
      `SELECT detail FROM events
        WHERE event_type = 'system:budget-alert'
          AND created_at >= ?
        ORDER BY id DESC
        LIMIT 5`
    ).all(cutoffIso) as Array<{ detail: string | null }>;
    for (const a of alerts) {
      risks.push(a.detail ? `Budget alert: ${a.detail.slice(0, 160)}` : 'Budget alert');
    }
  } catch (err) {
    log.warn(`budget alerts query failed: ${(err as Error).message}`);
  }

  const briefing: DailyBriefing = {
    generatedAt: now,
    yesterdayCompletions,
    todayQueue,
    costBurn,
    wins,
    risks,
  };

  cache = { briefing, expiresAt: now + CACHE_TTL_MS };
  return briefing;
}
