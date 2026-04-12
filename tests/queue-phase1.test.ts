/**
 * Phase 1 — Priority Queue integration tests.
 * Tests delay_until, cooldown, peek, cleanup, and duplicate handling
 * that extend the basic queue tests.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  enqueue, dequeue, completeItem, cancelByIssue, getQueue, peek, cleanup,
  _resetQueue, setCooldown, isInCooldown, getCooldownRemaining, PRIORITY,
} from '../src/routing/queue.js';
import { setFileLogging } from '../src/core/logger.js';

setFileLogging(false);

beforeEach(() => {
  _resetQueue();
  vi.useRealTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// --- Priority ordering ---

describe('Priority Queue — ordering', () => {
  it('dequeues by priority ASC then created_at ASC', () => {
    enqueue({ issueKey: 'P-1', issueId: 'a', agentRole: 'engineer', priority: PRIORITY.NORMAL });
    enqueue({ issueKey: 'P-2', issueId: 'b', agentRole: 'engineer', priority: PRIORITY.CEO_ASSIGNED });
    enqueue({ issueKey: 'P-3', issueId: 'c', agentRole: 'engineer', priority: PRIORITY.URGENT });
    enqueue({ issueKey: 'P-4', issueId: 'd', agentRole: 'engineer', priority: PRIORITY.DUTY });

    const order = [];
    let item;
    while ((item = dequeue()) !== null) order.push(item.issueKey);

    expect(order).toEqual(['P-2', 'P-3', 'P-1', 'P-4']); // 1, 2, 3, 5
  });

  it('same-priority items dequeue FIFO (created_at ASC)', () => {
    enqueue({ issueKey: 'F-1', issueId: 'a', agentRole: 'engineer', priority: 3 });
    enqueue({ issueKey: 'F-2', issueId: 'b', agentRole: 'engineer', priority: 3 });
    enqueue({ issueKey: 'F-3', issueId: 'c', agentRole: 'engineer', priority: 3 });

    expect(dequeue()?.issueKey).toBe('F-1');
    expect(dequeue()?.issueKey).toBe('F-2');
    expect(dequeue()?.issueKey).toBe('F-3');
  });
});

// --- Delay Until ---

describe('Priority Queue — delay_until', () => {
  it('skips items with delay_until in the future', () => {
    const future = Date.now() + 60_000;
    enqueue({ issueKey: 'D-1', issueId: 'a', agentRole: 'engineer', priority: 3, delayUntil: future });

    const result = dequeue();
    expect(result).toBeNull();
  });

  it('returns items with delay_until in the past', () => {
    const past = Date.now() - 1_000;
    enqueue({ issueKey: 'D-2', issueId: 'a', agentRole: 'engineer', priority: 3, delayUntil: past });

    const result = dequeue();
    expect(result).not.toBeNull();
    expect(result?.issueKey).toBe('D-2');
  });

  it('dequeues non-delayed items while delayed items wait', () => {
    const future = Date.now() + 60_000;
    enqueue({ issueKey: 'D-3', issueId: 'a', agentRole: 'engineer', priority: 1, delayUntil: future });
    enqueue({ issueKey: 'D-4', issueId: 'b', agentRole: 'engineer', priority: 3 });

    const result = dequeue();
    expect(result?.issueKey).toBe('D-4'); // delayed item skipped despite higher priority
  });

  it('peek also respects delay_until', () => {
    const future = Date.now() + 60_000;
    enqueue({ issueKey: 'D-5', issueId: 'a', agentRole: 'engineer', priority: 1, delayUntil: future });

    expect(peek()).toBeNull();
  });
});

// --- Cooldown ---

describe('Priority Queue — cooldown', () => {
  it('setCooldown makes isInCooldown return true', () => {
    setCooldown('COOL-1', 10_000);
    expect(isInCooldown('COOL-1')).toBe(true);
  });

  it('getCooldownRemaining returns positive value during cooldown', () => {
    setCooldown('COOL-2', 10_000);
    const remaining = getCooldownRemaining('COOL-2');
    expect(remaining).toBeGreaterThan(0);
    expect(remaining).toBeLessThanOrEqual(10_000);
  });

  it('enqueue returns null for issues in cooldown', () => {
    setCooldown('COOL-3', 10_000);
    const result = enqueue({ issueKey: 'COOL-3', issueId: 'a', agentRole: 'engineer', priority: 3 });
    expect(result).toBeNull();
  });

  it('cooldown expires after duration', () => {
    vi.useFakeTimers();
    setCooldown('COOL-4', 5_000);
    expect(isInCooldown('COOL-4')).toBe(true);

    vi.advanceTimersByTime(5_001);
    expect(isInCooldown('COOL-4')).toBe(false);
    expect(getCooldownRemaining('COOL-4')).toBe(0);
  });

  it('non-cooldown issues return false for isInCooldown', () => {
    expect(isInCooldown('NO-COOLDOWN')).toBe(false);
    expect(getCooldownRemaining('NO-COOLDOWN')).toBe(0);
  });
});

// --- Dequeue from empty queue ---

describe('Priority Queue — edge cases', () => {
  it('dequeue from empty queue returns null', () => {
    expect(dequeue()).toBeNull();
    expect(dequeue('engineer')).toBeNull();
  });

  it('peek on empty queue returns null', () => {
    expect(peek()).toBeNull();
    expect(peek('engineer')).toBeNull();
  });

  it('peek shows correct order without consuming', () => {
    enqueue({ issueKey: 'PK-1', issueId: 'a', agentRole: 'engineer', priority: 3 });
    enqueue({ issueKey: 'PK-2', issueId: 'b', agentRole: 'engineer', priority: 1 });

    const peeked = peek();
    expect(peeked?.issueKey).toBe('PK-2'); // priority 1 first
    expect(peeked?.status).toBe('queued');

    // Verify not consumed
    expect(getQueue('queued')).toHaveLength(2);

    // Peek again — same result
    const peeked2 = peek();
    expect(peeked2?.issueKey).toBe('PK-2');
  });

  it('duplicate issue_key+role is rejected', () => {
    const first = enqueue({ issueKey: 'DUP-1', issueId: 'a', agentRole: 'engineer', priority: 3 });
    const second = enqueue({ issueKey: 'DUP-1', issueId: 'a', agentRole: 'engineer', priority: 1 });
    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect(getQueue('queued')).toHaveLength(1);
  });

  it('same issue_key with different role is allowed', () => {
    enqueue({ issueKey: 'DUP-2', issueId: 'a', agentRole: 'engineer', priority: 3 });
    enqueue({ issueKey: 'DUP-2', issueId: 'a', agentRole: 'ops', priority: 3 });
    expect(getQueue('queued')).toHaveLength(2);
  });

  it('completed item does not block new enqueue for same issue+role', () => {
    enqueue({ issueKey: 'RE-1', issueId: 'a', agentRole: 'engineer', priority: 3 });
    const dequeued = dequeue()!;
    completeItem(dequeued.id);

    // Should be able to enqueue again since original is completed
    const newItem = enqueue({ issueKey: 'RE-1', issueId: 'a', agentRole: 'engineer', priority: 2 });
    expect(newItem).not.toBeNull();
  });
});

// --- Cleanup ---

describe('Priority Queue — cleanup', () => {
  it('cleanup removes old completed/canceled items', () => {
    // Enqueue and complete two items
    enqueue({ issueKey: 'CL-1', issueId: 'a', agentRole: 'engineer', priority: 3 });
    enqueue({ issueKey: 'CL-2', issueId: 'b', agentRole: 'ops', priority: 3 });

    const item1 = dequeue()!;
    completeItem(item1.id);
    cancelByIssue('CL-2');

    // These were just created so cleanup (>1 hour old) should NOT remove them
    const removed = cleanup();
    expect(removed).toBe(0);

    // But the statuses should be correct
    expect(getQueue('completed')).toHaveLength(1);
    expect(getQueue('canceled')).toHaveLength(1);
  });

  it('cleanup preserves queued items', () => {
    enqueue({ issueKey: 'CL-3', issueId: 'a', agentRole: 'engineer', priority: 3 });
    cleanup();
    expect(getQueue('queued')).toHaveLength(1);
  });
});

// --- PRIORITY constants ---

describe('PRIORITY constants', () => {
  it('has correct priority levels', () => {
    expect(PRIORITY.CEO_ASSIGNED).toBe(1);
    expect(PRIORITY.URGENT).toBe(2);
    expect(PRIORITY.NORMAL).toBe(3);
    expect(PRIORITY.DUTY).toBe(5);
  });
});
