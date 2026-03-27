import { describe, it, expect, beforeEach, vi } from 'vitest';
import { bus } from '../src/bus.js';

// Mock the Linear client before importing on-lifecycle
vi.mock('../src/linear/client.js', () => ({
  addComment: vi.fn().mockResolvedValue('comment-id'),
}));

import { addComment } from '../src/linear/client.js';
import { registerLifecycleHandlers } from '../src/hooks/on-lifecycle.js';

const mockedAddComment = vi.mocked(addComment);

beforeEach(() => {
  vi.clearAllMocks();
  // Clear bus listeners to avoid double-registration
  bus.off('agent:spawned');
  bus.off('agent:failed');
  bus.off('agent:suspended');
  bus.off('agent:resumed');
  bus.off('agent:idle');
  registerLifecycleHandlers();
});

describe('Lifecycle Comments', () => {
  it('posts comment on agent:spawned', async () => {
    await bus.emit('agent:spawned', { role: 'engineer', issueKey: 'ANC-1', tmuxSession: 'anc-engineer-ANC-1' });
    expect(mockedAddComment).toHaveBeenCalledOnce();
    expect(mockedAddComment).toHaveBeenCalledWith('ANC-1', expect.stringContaining('started working'), 'engineer');
  });

  it('posts comment on agent:failed with error detail', async () => {
    await bus.emit('agent:failed', { role: 'engineer', issueKey: 'ANC-1', error: 'tmux died' });
    expect(mockedAddComment).toHaveBeenCalledOnce();
    const body = mockedAddComment.mock.calls[0][1];
    expect(body).toContain('error');
    expect(body).toContain('tmux died');
  });

  it('posts comment on agent:suspended with reason', async () => {
    await bus.emit('agent:suspended', { role: 'ops', issueKey: 'ANC-2', reason: 'capacity' });
    expect(mockedAddComment).toHaveBeenCalledOnce();
    const body = mockedAddComment.mock.calls[0][1];
    expect(body).toContain('suspended');
    expect(body).toContain('capacity');
  });

  it('posts comment on agent:resumed', async () => {
    await bus.emit('agent:resumed', { role: 'strategist', issueKey: 'ANC-3', tmuxSession: 't' });
    expect(mockedAddComment).toHaveBeenCalledOnce();
    expect(mockedAddComment).toHaveBeenCalledWith('ANC-3', expect.stringContaining('resumed'), 'strategist');
  });

  it('does NOT post comment on agent:idle', async () => {
    await bus.emit('agent:idle', { role: 'engineer', issueKey: 'ANC-1' });
    expect(mockedAddComment).not.toHaveBeenCalled();
  });

  it('uses agent role as comment identity (third arg)', async () => {
    await bus.emit('agent:spawned', { role: 'strategist', issueKey: 'ANC-5', tmuxSession: 't' });
    expect(mockedAddComment).toHaveBeenCalledWith('ANC-5', expect.any(String), 'strategist');
  });
});

describe('Duty Session Filtering', () => {
  it('skips pulse-* sessions on spawned', async () => {
    await bus.emit('agent:spawned', { role: 'ops', issueKey: 'pulse-daily', tmuxSession: 't' });
    expect(mockedAddComment).not.toHaveBeenCalled();
  });

  it('skips postmortem-* sessions on failed', async () => {
    await bus.emit('agent:failed', { role: 'ops', issueKey: 'postmortem-123', error: 'err' });
    expect(mockedAddComment).not.toHaveBeenCalled();
  });

  it('skips pulse-* sessions on suspended', async () => {
    await bus.emit('agent:suspended', { role: 'ops', issueKey: 'pulse-weekly', reason: 'capacity' });
    expect(mockedAddComment).not.toHaveBeenCalled();
  });

  it('skips postmortem-* sessions on resumed', async () => {
    await bus.emit('agent:resumed', { role: 'ops', issueKey: 'postmortem-456', tmuxSession: 't' });
    expect(mockedAddComment).not.toHaveBeenCalled();
  });

  it('skips pulse-* sessions on idle', async () => {
    await bus.emit('agent:idle', { role: 'ops', issueKey: 'pulse-hourly' });
    expect(mockedAddComment).not.toHaveBeenCalled();
  });
});

describe('Comment Content Format', () => {
  it('spawned comment includes bold role name', async () => {
    await bus.emit('agent:spawned', { role: 'engineer', issueKey: 'ANC-10', tmuxSession: 't' });
    const body = mockedAddComment.mock.calls[0][1];
    expect(body).toContain('**engineer**');
  });

  it('failed comment includes backtick-wrapped error', async () => {
    await bus.emit('agent:failed', { role: 'engineer', issueKey: 'ANC-10', error: 'ENOENT: tmux' });
    const body = mockedAddComment.mock.calls[0][1];
    expect(body).toContain('`ENOENT: tmux`');
  });

  it('failed comment mentions circuit breaker', async () => {
    await bus.emit('agent:failed', { role: 'engineer', issueKey: 'ANC-10', error: 'spawn failed' });
    const body = mockedAddComment.mock.calls[0][1];
    expect(body).toContain('Circuit breaker');
  });

  it('suspended comment mentions reason and resume intent', async () => {
    await bus.emit('agent:suspended', { role: 'engineer', issueKey: 'ANC-10', reason: 'capacity' });
    const body = mockedAddComment.mock.calls[0][1];
    expect(body).toContain('resume');
  });
});
