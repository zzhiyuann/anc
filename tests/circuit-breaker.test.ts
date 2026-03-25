import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  isBreakerTripped, recordFailure, recordSuccess,
  getTrippedBreakers, cleanupBreakers, _resetBreakers,
} from '../src/runtime/circuit-breaker.js';

beforeEach(() => {
  _resetBreakers();
  vi.useRealTimers();
});

describe('Circuit Breaker', () => {
  it('allows first 2 failures without tripping', () => {
    recordFailure('RYA-1');
    recordFailure('RYA-1');
    expect(isBreakerTripped('RYA-1')).toBe(0);
  });

  it('trips on 3rd failure with 60s backoff', () => {
    recordFailure('RYA-1');
    recordFailure('RYA-1');
    const backoff = recordFailure('RYA-1');
    expect(backoff).toBe(60_000);
    expect(isBreakerTripped('RYA-1')).toBeGreaterThan(0);
  });

  it('doubles backoff on each subsequent failure', () => {
    for (let i = 0; i < 3; i++) recordFailure('RYA-1');
    expect(isBreakerTripped('RYA-1')).toBeGreaterThan(0);

    // 4th failure
    const backoff4 = recordFailure('RYA-1');
    expect(backoff4).toBe(120_000);  // 60s × 2^1

    // 5th failure
    const backoff5 = recordFailure('RYA-1');
    expect(backoff5).toBe(240_000);  // 60s × 2^2
  });

  it('caps backoff at 30 minutes', () => {
    for (let i = 0; i < 20; i++) recordFailure('RYA-1');
    const last = recordFailure('RYA-1');
    expect(last).toBeLessThanOrEqual(30 * 60_000);
  });

  it('resets on success', () => {
    for (let i = 0; i < 3; i++) recordFailure('RYA-1');
    expect(isBreakerTripped('RYA-1')).toBeGreaterThan(0);
    recordSuccess('RYA-1');
    expect(isBreakerTripped('RYA-1')).toBe(0);
  });

  it('clears after backoff period expires', () => {
    vi.useFakeTimers();
    for (let i = 0; i < 3; i++) recordFailure('RYA-1');
    expect(isBreakerTripped('RYA-1')).toBeGreaterThan(0);

    vi.advanceTimersByTime(61_000);  // past 60s backoff
    expect(isBreakerTripped('RYA-1')).toBe(0);
    vi.useRealTimers();
  });

  it('tracks multiple issues independently', () => {
    for (let i = 0; i < 3; i++) recordFailure('RYA-1');
    recordFailure('RYA-2');
    expect(isBreakerTripped('RYA-1')).toBeGreaterThan(0);
    expect(isBreakerTripped('RYA-2')).toBe(0);
  });

  it('getTrippedBreakers returns only active breakers', () => {
    for (let i = 0; i < 3; i++) recordFailure('RYA-1');
    for (let i = 0; i < 3; i++) recordFailure('RYA-2');
    recordSuccess('RYA-2');
    const tripped = getTrippedBreakers();
    expect(tripped).toHaveLength(1);
    expect(tripped[0].issueKey).toBe('RYA-1');
  });

  it('cleanupBreakers removes old entries', () => {
    vi.useFakeTimers();
    recordFailure('RYA-old');
    vi.advanceTimersByTime(3 * 3600_000);  // 3 hours later
    recordFailure('RYA-new');
    cleanupBreakers();
    // RYA-old should be cleaned up (> 2 hours)
    expect(isBreakerTripped('RYA-old')).toBe(0);
    vi.useRealTimers();
  });
});
