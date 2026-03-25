import { describe, it, expect, beforeEach } from 'vitest';
import { routeComment, routeIssue, type CommentContext } from '../src/routing/router.js';
import { _resetCache, isSelfNote, loadRoutingConfig } from '../src/routing/rules.js';
import { _resetRegistry } from '../src/agents/registry.js';
import type { CommentPayload, IssuePayload } from '../src/linear/types.js';

// Mock registry before tests
beforeEach(() => {
  _resetCache();
  _resetRegistry();
});

function makeIssue(overrides: Partial<IssuePayload> = {}): IssuePayload {
  return {
    id: 'issue-1',
    identifier: 'RYA-100',
    title: 'Test issue',
    priority: 3,
    ...overrides,
  };
}

function makeComment(overrides: Partial<CommentPayload> = {}): CommentPayload {
  return {
    id: 'comment-1',
    body: 'Hello',
    issueId: 'issue-1',
    userId: 'user-1',
    ...overrides,
  };
}

describe('routeIssue', () => {
  it('routes Bug label to engineer', () => {
    const decision = routeIssue(makeIssue({ labels: ['Bug'] }));
    expect(decision.target).toBe('engineer');
    expect(decision.reason).toContain('Bug');
  });

  it('routes Plan label to strategist', () => {
    const decision = routeIssue(makeIssue({ labels: ['Plan'] }));
    expect(decision.target).toBe('strategist');
  });

  it('defaults to ops', () => {
    const decision = routeIssue(makeIssue({ labels: [] }));
    expect(decision.target).toBe('ops');
  });
});

describe('routeComment', () => {
  it('routes @engineer mention', () => {
    const ctx: CommentContext = {
      comment: makeComment({ body: '@engineer please fix this' }),
      issue: makeIssue(),
    };
    const decision = routeComment(ctx);
    expect(decision.target).toBe('engineer');
  });

  it('skips self-notes', () => {
    const ctx: CommentContext = {
      comment: makeComment({ body: 'self: just a note to myself' }),
      issue: makeIssue(),
    };
    const decision = routeComment(ctx);
    expect(decision.target).toBe('skip');
  });

  it('falls through to last_active agent', () => {
    const ctx: CommentContext = {
      comment: makeComment({ body: 'any update on this?' }),
      issue: makeIssue(),
      lastActiveAgent: 'engineer',
    };
    const decision = routeComment(ctx);
    expect(decision.target).toBe('engineer');
    expect(decision.reason).toContain('last active');
  });

  it('skips when no routing matches', () => {
    const ctx: CommentContext = {
      comment: makeComment({ body: 'just thinking...' }),
      issue: makeIssue(),
    };
    const decision = routeComment(ctx);
    expect(decision.target).toBe('skip');
  });
});

describe('isSelfNote', () => {
  it('detects self: prefix', () => {
    const config = loadRoutingConfig();
    expect(isSelfNote('self: my note', config)).toBe(true);
    expect(isSelfNote('  self: indented', config)).toBe(true);
    expect(isSelfNote('note: another note', config)).toBe(true);
    expect(isSelfNote('hello world', config)).toBe(false);
  });
});
