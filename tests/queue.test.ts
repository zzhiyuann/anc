import { describe, it, expect, beforeEach } from 'vitest';
import { enqueue, dequeue, completeItem, cancelByIssue, getQueue, peek, cleanup, _resetQueue } from '../src/routing/queue.js';

beforeEach(() => {
  _resetQueue();
});

describe('Priority Queue', () => {
  it('enqueues and dequeues by priority', () => {
    enqueue({ issueKey: 'RYA-1', issueId: 'a', agentRole: 'engineer', priority: 3 });
    enqueue({ issueKey: 'RYA-2', issueId: 'b', agentRole: 'engineer', priority: 1 });
    enqueue({ issueKey: 'RYA-3', issueId: 'c', agentRole: 'engineer', priority: 2 });

    const first = dequeue();
    expect(first?.issueKey).toBe('RYA-2');  // priority 1 = highest
    const second = dequeue();
    expect(second?.issueKey).toBe('RYA-3');  // priority 2
    const third = dequeue();
    expect(third?.issueKey).toBe('RYA-1');  // priority 3
  });

  it('deduplicates by issue+role', () => {
    const first = enqueue({ issueKey: 'RYA-1', issueId: 'a', agentRole: 'engineer', priority: 3 });
    const dupe = enqueue({ issueKey: 'RYA-1', issueId: 'a', agentRole: 'engineer', priority: 3 });
    expect(first).not.toBeNull();
    expect(dupe).toBeNull();
    expect(getQueue('queued').length).toBe(1);
  });

  it('allows same issue for different roles', () => {
    enqueue({ issueKey: 'RYA-1', issueId: 'a', agentRole: 'engineer', priority: 3 });
    enqueue({ issueKey: 'RYA-1', issueId: 'a', agentRole: 'ops', priority: 3 });
    expect(getQueue('queued').length).toBe(2);
  });

  it('dequeue by role', () => {
    enqueue({ issueKey: 'RYA-1', issueId: 'a', agentRole: 'engineer', priority: 3 });
    enqueue({ issueKey: 'RYA-2', issueId: 'b', agentRole: 'ops', priority: 1 });

    const eng = dequeue('engineer');
    expect(eng?.issueKey).toBe('RYA-1');
    const ops = dequeue('ops');
    expect(ops?.issueKey).toBe('RYA-2');
  });

  it('completes items', () => {
    const item = enqueue({ issueKey: 'RYA-1', issueId: 'a', agentRole: 'engineer', priority: 3 })!;
    const dequeued = dequeue()!;
    completeItem(dequeued.id);
    expect(getQueue('completed').length).toBe(1);
  });

  it('cancels by issue', () => {
    enqueue({ issueKey: 'RYA-1', issueId: 'a', agentRole: 'engineer', priority: 3 });
    enqueue({ issueKey: 'RYA-1', issueId: 'a', agentRole: 'ops', priority: 2 });
    const count = cancelByIssue('RYA-1');
    expect(count).toBe(2);
    expect(getQueue('queued').length).toBe(0);
  });

  it('peek does not dequeue', () => {
    enqueue({ issueKey: 'RYA-1', issueId: 'a', agentRole: 'engineer', priority: 3 });
    const peeked = peek();
    expect(peeked?.issueKey).toBe('RYA-1');
    expect(peeked?.status).toBe('queued');
    expect(getQueue('queued').length).toBe(1);
  });
});
