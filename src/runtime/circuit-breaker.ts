/**
 * Circuit breaker — prevents infinite retry on failing issues.
 * Tracks consecutive failures per issue with exponential backoff.
 */

import { bus } from '../bus.js';

interface BreakerEntry {
  failCount: number;
  lastFailAt: number;
  backoffUntil: number;
}

const breakers = new Map<string, BreakerEntry>();

const MAX_FAILURES = 3;
const BASE_BACKOFF_MS = 60_000;       // 60s
const MAX_BACKOFF_MS = 30 * 60_000;   // 30min

/** Check if issue is tripped. Returns ms remaining, or 0 if clear. */
export function isBreakerTripped(issueKey: string): number {
  const entry = breakers.get(issueKey);
  if (!entry || entry.failCount < MAX_FAILURES) return 0;
  const remaining = entry.backoffUntil - Date.now();
  return remaining > 0 ? remaining : 0;
}

/** Record a failure. Returns backoff duration in ms (0 if not yet tripped). */
export function recordFailure(issueKey: string): number {
  const entry = breakers.get(issueKey) ?? { failCount: 0, lastFailAt: 0, backoffUntil: 0 };
  entry.failCount++;
  entry.lastFailAt = Date.now();

  if (entry.failCount >= MAX_FAILURES) {
    const exponent = entry.failCount - MAX_FAILURES;
    const backoff = Math.min(BASE_BACKOFF_MS * Math.pow(2, exponent), MAX_BACKOFF_MS);
    entry.backoffUntil = Date.now() + backoff;
    breakers.set(issueKey, entry);
    void bus.emit('system:circuit-breaker-tripped', {
      issueKey,
      failCount: entry.failCount,
      backoffMs: backoff,
    });
    return backoff;
  }

  breakers.set(issueKey, entry);
  return 0;
}

/** Record success — reset breaker for this issue. */
export function recordSuccess(issueKey: string): void {
  breakers.delete(issueKey);
}

/** Get all currently tripped breakers. */
export function getTrippedBreakers(): Array<{ issueKey: string; failCount: number; backoffUntil: number }> {
  const now = Date.now();
  return [...breakers.entries()]
    .filter(([, e]) => e.failCount >= MAX_FAILURES && e.backoffUntil > now)
    .map(([issueKey, e]) => ({ issueKey, failCount: e.failCount, backoffUntil: e.backoffUntil }));
}

/** Cleanup old entries (> 2 hours since last failure). */
export function cleanupBreakers(): void {
  const cutoff = Date.now() - 2 * 3600_000;
  for (const [key, entry] of breakers) {
    if (entry.lastFailAt < cutoff) breakers.delete(key);
  }
}

export function _resetBreakers(): void {
  breakers.clear();
}
