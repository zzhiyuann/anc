import { describe, it, expect, beforeEach, vi } from 'vitest';
import { bus } from '../src/bus.js';

// Mock all dependencies before importing on-lifecycle
vi.mock('../src/linear/client.js', () => ({
  addComment: vi.fn().mockResolvedValue('comment-id'),
}));

vi.mock('../src/channels/discord.js', () => ({
  postToDiscord: vi.fn().mockResolvedValue('discord-msg-id'),
  addReactions: vi.fn().mockResolvedValue(undefined),
  reactToMessage: vi.fn().mockResolvedValue(undefined),
  replyInDiscord: vi.fn().mockResolvedValue(null),
}));

vi.mock('../src/bridge/mappings.js', () => ({
  getRootLink: vi.fn().mockReturnValue(null),
}));

import { addComment } from '../src/linear/client.js';
import { postToDiscord, addReactions } from '../src/channels/discord.js';
import { registerLifecycleHandlers, _resetLifecycle } from '../src/hooks/on-lifecycle.js';

const mockedAddComment = vi.mocked(addComment);
const mockedPostToDiscord = vi.mocked(postToDiscord);
const mockedAddReactions = vi.mocked(addReactions);

beforeEach(() => {
  vi.clearAllMocks();
  _resetLifecycle();
  mockedPostToDiscord.mockResolvedValue('discord-msg-id');

  bus.removeAllListeners('agent:spawned');
  bus.removeAllListeners('agent:failed');
  bus.removeAllListeners('agent:suspended');
  bus.removeAllListeners('agent:resumed');
  bus.removeAllListeners('agent:idle');
  bus.removeAllListeners('agent:completed');
  registerLifecycleHandlers();
});

// ---- Lifecycle Comments ----

describe('Lifecycle Comments', () => {
  it('posts comment on agent:spawned', async () => {
    await bus.emit('agent:spawned', { role: 'engineer', issueKey: 'ANC-1', tmuxSession: 'anc-engineer-ANC-1' });
    expect(mockedAddComment).toHaveBeenCalledWith('ANC-1', expect.stringContaining('picked up'), 'engineer');
  });

  it('posts comment on agent:failed with error detail', async () => {
    await bus.emit('agent:failed', { role: 'engineer', issueKey: 'ANC-1', error: 'tmux died' });
    const body = mockedAddComment.mock.calls[0][1];
    expect(body).toContain('error');
    expect(body).toContain('tmux died');
  });

  it('posts comment on agent:suspended with reason', async () => {
    await bus.emit('agent:suspended', { role: 'ops', issueKey: 'ANC-2', reason: 'capacity' });
    const body = mockedAddComment.mock.calls[0][1];
    expect(body).toContain('suspended');
    expect(body).toContain('capacity');
  });

  it('posts comment on agent:resumed', async () => {
    await bus.emit('agent:resumed', { role: 'strategist', issueKey: 'ANC-3', tmuxSession: 't' });
    expect(mockedAddComment).toHaveBeenCalledWith('ANC-3', expect.stringContaining('resumed'), 'strategist');
  });

  it('does NOT post comment on agent:idle', async () => {
    await bus.emit('agent:idle', { role: 'engineer', issueKey: 'ANC-1' });
    expect(mockedAddComment).not.toHaveBeenCalled();
  });

  it('skips spawned comment on re-spawn (dedup)', async () => {
    await bus.emit('agent:spawned', { role: 'engineer', issueKey: 'ANC-1', tmuxSession: 't' });
    expect(mockedAddComment).toHaveBeenCalledOnce();
    vi.clearAllMocks();
    await bus.emit('agent:spawned', { role: 'engineer', issueKey: 'ANC-1', tmuxSession: 't2' });
    expect(mockedAddComment).not.toHaveBeenCalled();
  });

  it('re-allows spawned comment after completed (issue reopened)', async () => {
    await bus.emit('agent:spawned', { role: 'engineer', issueKey: 'ANC-1', tmuxSession: 't' });
    vi.clearAllMocks();
    await bus.emit('agent:completed', { role: 'engineer', issueKey: 'ANC-1', handoff: 'done' });
    vi.clearAllMocks();
    await bus.emit('agent:spawned', { role: 'engineer', issueKey: 'ANC-1', tmuxSession: 't3' });
    expect(mockedAddComment).toHaveBeenCalledWith('ANC-1', expect.stringContaining('picked up'), 'engineer');
  });

  it('uses agent role as comment identity (third arg)', async () => {
    await bus.emit('agent:spawned', { role: 'strategist', issueKey: 'ANC-5', tmuxSession: 't' });
    expect(mockedAddComment).toHaveBeenCalledWith('ANC-5', expect.any(String), 'strategist');
  });
});

// ---- Duty Session Filtering ----

describe('Duty Session Filtering', () => {
  it('skips pulse-* sessions on spawned', async () => {
    await bus.emit('agent:spawned', { role: 'ops', issueKey: 'pulse-daily', tmuxSession: 't' });
    expect(mockedAddComment).not.toHaveBeenCalled();
  });

  it('skips postmortem-* sessions on failed', async () => {
    await bus.emit('agent:failed', { role: 'ops', issueKey: 'postmortem-123', error: 'err' });
    expect(mockedAddComment).not.toHaveBeenCalled();
  });

  it('skips healthcheck-* sessions on spawned', async () => {
    await bus.emit('agent:spawned', { role: 'ceo-office', issueKey: 'healthcheck-1234', tmuxSession: 't' });
    expect(mockedAddComment).not.toHaveBeenCalled();
  });

  it('skips recovery-* sessions on failed', async () => {
    await bus.emit('agent:failed', { role: 'ceo-office', issueKey: 'recovery-ANC-42', error: 'err' });
    expect(mockedAddComment).not.toHaveBeenCalled();
  });

  it('skips duty sessions on completed', async () => {
    await bus.emit('agent:completed', { role: 'ops', issueKey: 'pulse-daily', handoff: 'done' });
    expect(mockedPostToDiscord).not.toHaveBeenCalled();
  });
});

// ---- Comment Content Format ----

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

// ---- AgentSession Removed ----
// AgentSession API was removed (comment-based sync only).
// No create/dismiss/linearSessionId tests needed.

// ---- Discord Notifications ----

describe('Discord Notifications', () => {
  it('posts to Discord on agent:failed', async () => {
    await bus.emit('agent:failed', { role: 'engineer', issueKey: 'ANC-1', error: 'boom' });
    expect(mockedPostToDiscord).toHaveBeenCalledWith('engineer', expect.stringContaining('ANC-1'));
    expect(mockedAddReactions).toHaveBeenCalledWith('discord-msg-id', ['❌']);
  });

  it('posts to Discord on agent:completed', async () => {
    await bus.emit('agent:completed', { role: 'engineer', issueKey: 'ANC-1', handoff: '# HANDOFF\n\n## Summary\n\nDid the thing.' });
    expect(mockedPostToDiscord).toHaveBeenCalledWith('engineer', expect.stringContaining('done'));
    expect(mockedPostToDiscord).toHaveBeenCalledWith('engineer', expect.stringContaining('ANC-1'));
  });

  it('adds warning reaction when handoff has quality check warnings', async () => {
    await bus.emit('agent:completed', { role: 'engineer', issueKey: 'ANC-1', handoff: '# Done\n\nQuality check warnings found.' });
    expect(mockedAddReactions).toHaveBeenCalledWith('discord-msg-id', ['⚠️']);
  });

  it('skips reactions when Discord post fails', async () => {
    mockedPostToDiscord.mockResolvedValue(null as any);
    await bus.emit('agent:failed', { role: 'engineer', issueKey: 'ANC-1', error: 'err' });
    expect(mockedAddReactions).not.toHaveBeenCalled();
  });
});
