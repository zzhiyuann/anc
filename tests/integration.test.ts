/**
 * Integration tests — end-to-end webhook→route→resolve flow.
 * Uses real routing/lifecycle logic with mocked tmux (no real processes).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { routeIssue, routeComment, type CommentContext } from '../src/routing/router.js';
import { _resetHealth, trackSession, getSessionForIssue, hasCapacity, getActiveSessions } from '../src/runtime/health.js';
import { _resetBreakers, isBreakerTripped, recordFailure } from '../src/runtime/circuit-breaker.js';
import { _resetQueue, enqueue, dequeue, getQueue } from '../src/routing/queue.js';
import { _resetRegistry } from '../src/agents/registry.js';
import { _resetCache } from '../src/routing/rules.js';
import { _resetRateLimit, getRateLimitStatus, withRateLimit } from '../src/linear/rate-limiter.js';
import { setFileLogging } from '../src/core/logger.js';
import type { IssuePayload, CommentPayload } from '../src/linear/types.js';

// Disable file logging during tests
setFileLogging(false);

beforeEach(() => {
  _resetHealth();
  _resetBreakers();
  _resetQueue();
  _resetRegistry();
  _resetCache();
  _resetRateLimit();
});

// --- Helpers ---

function makeIssue(overrides: Partial<IssuePayload> = {}): IssuePayload {
  return {
    id: 'issue-1',
    identifier: 'ANC-100',
    title: 'Test issue',
    priority: 3,
    ...overrides,
  };
}

function makeComment(overrides: Partial<CommentPayload> = {}): CommentPayload {
  return {
    id: 'comment-1',
    body: 'Please look into this',
    issueId: 'issue-1',
    userId: 'user-ceo',
    ...overrides,
  };
}

// --- Webhook → Route → Resolve integration ---

describe('webhook → route flow', () => {
  it('routes a new issue through label-based routing', () => {
    const issue = makeIssue({ labels: ['Bug'], title: 'Login page crashes' });
    const decision = routeIssue(issue);
    expect(decision.target).toBe('engineer');
    expect(decision.issueKey).toBe('ANC-100');
    expect(decision.priority).toBe(3);
  });

  it('routes a comment with @mention to correct agent', () => {
    const ctx: CommentContext = {
      comment: makeComment({ body: '@strategist what do you think about this approach?' }),
      issue: makeIssue(),
    };
    const decision = routeComment(ctx);
    expect(decision.target).toBe('strategist');
    expect(decision.reason).toContain('mentioned');
  });

  it('routes unlabeled issues to ops (default)', () => {
    const issue = makeIssue({ labels: [], title: 'Something happened' });
    const decision = routeIssue(issue);
    expect(decision.target).toBe('ops');
    expect(decision.reason).toContain('default');
  });

  it('routes title pattern [Strategy] to strategist', () => {
    const issue = makeIssue({ title: '[Strategy] Revenue model evaluation' });
    const decision = routeIssue(issue);
    expect(decision.target).toBe('strategist');
  });
});

// --- Session lifecycle ---

describe('session lifecycle', () => {
  it('tracks and queries sessions correctly', () => {
    trackSession({
      role: 'engineer', issueKey: 'ANC-1', tmuxSession: 'anc-engineer-ANC-1',
      spawnedAt: Date.now(), priority: 2, ceoAssigned: false, useContinue: false,
    });

    const session = getSessionForIssue('ANC-1');
    expect(session).toBeDefined();
    expect(session!.role).toBe('engineer');
    expect(session!.state).toBe('active');

    const active = getActiveSessions('engineer');
    expect(active).toHaveLength(1);
  });

  it('respects capacity limits', () => {
    // Default maxConcurrency is 5 for engineer
    for (let i = 0; i < 5; i++) {
      trackSession({
        role: 'engineer', issueKey: `ANC-${i}`, tmuxSession: `anc-engineer-ANC-${i}`,
        spawnedAt: Date.now(), priority: 3, ceoAssigned: false, useContinue: false,
      });
    }

    expect(hasCapacity('engineer')).toBe(false);
  });
});

// --- Circuit breaker ---

describe('circuit breaker', () => {
  it('trips after 3 consecutive failures', () => {
    expect(isBreakerTripped('ANC-1')).toBe(0);
    recordFailure('ANC-1');
    recordFailure('ANC-1');
    expect(isBreakerTripped('ANC-1')).toBe(0); // not yet tripped
    recordFailure('ANC-1');
    expect(isBreakerTripped('ANC-1')).toBeGreaterThan(0); // now tripped
  });
});

// --- Queue ---

describe('priority queue', () => {
  it('enqueues and dequeues by priority', () => {
    enqueue({ issueKey: 'ANC-1', issueId: '', agentRole: 'engineer', priority: 3 });
    enqueue({ issueKey: 'ANC-2', issueId: '', agentRole: 'engineer', priority: 1 });
    enqueue({ issueKey: 'ANC-3', issueId: '', agentRole: 'ops', priority: 2 });

    // Dequeue engineer — should get priority 1 first
    const first = dequeue('engineer');
    expect(first?.issueKey).toBe('ANC-2');
    expect(first?.priority).toBe(1);

    const second = dequeue('engineer');
    expect(second?.issueKey).toBe('ANC-1');
  });

  it('deduplicates by issue+role', () => {
    const first = enqueue({ issueKey: 'ANC-1', issueId: '', agentRole: 'engineer', priority: 3 });
    const dup = enqueue({ issueKey: 'ANC-1', issueId: '', agentRole: 'engineer', priority: 1 });
    expect(first).not.toBeNull();
    expect(dup).toBeNull();

    // Same issue, different role is OK
    const different = enqueue({ issueKey: 'ANC-1', issueId: '', agentRole: 'ops', priority: 2 });
    expect(different).not.toBeNull();
  });

  it('filters by status', () => {
    enqueue({ issueKey: 'ANC-1', issueId: '', agentRole: 'engineer', priority: 3 });
    enqueue({ issueKey: 'ANC-2', issueId: '', agentRole: 'ops', priority: 2 });

    const queued = getQueue('queued');
    expect(queued).toHaveLength(2);

    dequeue('engineer'); // status → processing
    const stillQueued = getQueue('queued');
    expect(stillQueued).toHaveLength(1);
  });
});

// --- Rate limiter ---

describe('rate limiter', () => {
  it('starts with full bucket', () => {
    const status = getRateLimitStatus();
    expect(status.tokens).toBe(50);
    expect(status.max).toBe(50);
  });

  it('consumes tokens on each call', async () => {
    let callCount = 0;
    const fn = async () => { callCount++; return 'ok'; };

    await withRateLimit(fn);
    await withRateLimit(fn);
    await withRateLimit(fn);

    expect(callCount).toBe(3);
    const status = getRateLimitStatus();
    expect(status.tokens).toBe(47);
  });

  it('executes the wrapped function and returns its result', async () => {
    const result = await withRateLimit(async () => 42);
    expect(result).toBe(42);
  });
});

// --- End-to-end: issue → route → queue ---

describe('end-to-end: issue → route → queue when at capacity', () => {
  it('queues when agent is at capacity', () => {
    // Fill engineer capacity
    for (let i = 0; i < 5; i++) {
      trackSession({
        role: 'engineer', issueKey: `ANC-${i}`, tmuxSession: `anc-engineer-ANC-${i}`,
        spawnedAt: Date.now(), priority: 3, ceoAssigned: false, useContinue: false,
      });
    }

    // Route a new Bug issue → engineer
    const issue = makeIssue({ identifier: 'ANC-99', labels: ['Bug'] });
    const decision = routeIssue(issue);
    expect(decision.target).toBe('engineer');

    // Engineer is full → would be queued by resolveSession
    expect(hasCapacity('engineer')).toBe(false);

    // Manually enqueue (simulating what resolveSession would do)
    const queued = enqueue({
      issueKey: issue.identifier,
      issueId: issue.id,
      agentRole: decision.target,
      priority: decision.priority,
    });
    expect(queued).not.toBeNull();
    expect(getQueue('queued')).toHaveLength(1);
  });
});
