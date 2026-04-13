/**
 * Agent auto-comments — verify that lifecycle events produce task_comments
 * with correct author attribution (agent:<role>, not ceo).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { bus } from '../src/bus.js';

// Mock external dependencies
vi.mock('../src/linear/client.js', () => ({
  addComment: vi.fn().mockResolvedValue('comment-id'),
  getIssue: vi.fn().mockResolvedValue(null),
  setIssueStatus: vi.fn().mockResolvedValue(true),
  createSubIssue: vi.fn().mockResolvedValue(null),
}));

vi.mock('../src/channels/discord.js', () => ({
  postToDiscord: vi.fn().mockResolvedValue(null),
  addReactions: vi.fn().mockResolvedValue(undefined),
  replyInDiscord: vi.fn().mockResolvedValue(null),
}));

vi.mock('../src/bridge/mappings.js', () => ({
  getRootLink: vi.fn().mockReturnValue(null),
}));

// Mock tasks module — capture addTaskComment calls
const addTaskCommentMock = vi.fn().mockReturnValue(1);
vi.mock('../src/core/tasks.js', () => ({
  resolveTaskIdFromIssueKey: vi.fn().mockReturnValue('task-123'),
  addTaskComment: (...args: unknown[]) => addTaskCommentMock(...args),
  setTaskState: vi.fn(),
  createTask: vi.fn().mockReturnValue({ id: 'task-child' }),
  getTask: vi.fn().mockReturnValue(null),
}));

vi.mock('../src/core/budget.js', () => ({
  recordSpend: vi.fn(),
  estimateCost: vi.fn().mockReturnValue(0.01),
}));

vi.mock('../src/routing/queue.js', () => ({
  setCooldown: vi.fn(),
}));

import { registerLifecycleHandlers, _resetLifecycle } from '../src/hooks/on-lifecycle.js';

beforeEach(() => {
  vi.clearAllMocks();
  _resetLifecycle();

  bus.removeAllListeners('agent:spawned');
  bus.removeAllListeners('agent:failed');
  bus.removeAllListeners('agent:suspended');
  bus.removeAllListeners('agent:resumed');
  bus.removeAllListeners('agent:idle');
  bus.removeAllListeners('agent:completed');
  registerLifecycleHandlers();
});

// ---- Agent auto-comments with correct attribution ----

describe('Agent Auto-Comments (task_comments)', () => {
  it('posts "Starting work" comment with agent:role author on spawn', async () => {
    await bus.emit('agent:spawned', { role: 'engineer', issueKey: 'ANC-42', tmuxSession: 't' });
    expect(addTaskCommentMock).toHaveBeenCalledWith(
      'task-123',
      'agent:engineer',
      'Starting work on this task.',
    );
  });

  it('posts error comment with agent:role author on failure', async () => {
    await bus.emit('agent:failed', { role: 'ops', issueKey: 'ANC-99', error: 'tmux crash' });
    expect(addTaskCommentMock).toHaveBeenCalledWith(
      'task-123',
      'agent:ops',
      'Error: tmux crash',
    );
  });

  it('posts suspend comment with agent:role author', async () => {
    await bus.emit('agent:suspended', { role: 'strategist', issueKey: 'ANC-55', reason: 'capacity full' });
    expect(addTaskCommentMock).toHaveBeenCalledWith(
      'task-123',
      'agent:strategist',
      'Suspended: capacity full',
    );
  });

  it('posts resume comment with agent:role author', async () => {
    await bus.emit('agent:resumed', { role: 'engineer', issueKey: 'ANC-42', tmuxSession: 't' });
    expect(addTaskCommentMock).toHaveBeenCalledWith(
      'task-123',
      'agent:engineer',
      'Resumed working.',
    );
  });

  it('does NOT post task comment on idle (no noise)', async () => {
    await bus.emit('agent:idle', { role: 'engineer', issueKey: 'ANC-42' });
    expect(addTaskCommentMock).not.toHaveBeenCalled();
  });

  it('skips task comment for duty sessions', async () => {
    await bus.emit('agent:spawned', { role: 'ops', issueKey: 'pulse-daily', tmuxSession: 't' });
    expect(addTaskCommentMock).not.toHaveBeenCalled();
  });

  it('author format is agent:<role>, never just the role name', async () => {
    await bus.emit('agent:spawned', { role: 'engineer', issueKey: 'ANC-10', tmuxSession: 't' });
    const author = addTaskCommentMock.mock.calls[0][1];
    expect(author).toBe('agent:engineer');
    expect(author).toMatch(/^agent:/);
  });
});
