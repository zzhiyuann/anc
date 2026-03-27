import { describe, it, expect, beforeEach, vi } from 'vitest';
import { bus } from '../src/bus.js';

// Mock all dependencies before importing on-lifecycle
vi.mock('../src/linear/client.js', () => ({
  addComment: vi.fn().mockResolvedValue('comment-id'),
  getIssue: vi.fn().mockResolvedValue({ id: 'issue-uuid-1', identifier: 'ANC-1' }),
  createAgentSession: vi.fn().mockResolvedValue('session-uuid-1'),
  dismissSession: vi.fn().mockResolvedValue(true),
}));

vi.mock('../src/runtime/health.js', () => ({
  getSessionForIssue: vi.fn().mockReturnValue({ linearSessionId: 'session-uuid-1' }),
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

import { addComment, getIssue, createAgentSession, dismissSession } from '../src/linear/client.js';
import { getSessionForIssue } from '../src/runtime/health.js';
import { postToDiscord, addReactions } from '../src/channels/discord.js';
import { registerLifecycleHandlers, _resetLifecycle } from '../src/hooks/on-lifecycle.js';

const mockedAddComment = vi.mocked(addComment);
const mockedGetIssue = vi.mocked(getIssue);
const mockedCreateAgentSession = vi.mocked(createAgentSession);
const mockedDismissSession = vi.mocked(dismissSession);
const mockedGetSession = vi.mocked(getSessionForIssue);
const mockedPostToDiscord = vi.mocked(postToDiscord);
const mockedAddReactions = vi.mocked(addReactions);

beforeEach(() => {
  vi.clearAllMocks();
  _resetLifecycle();  // clear startedCommented set
  // Reset defaults
  mockedGetIssue.mockResolvedValue({ id: 'issue-uuid-1', identifier: 'ANC-1' } as any);
  mockedCreateAgentSession.mockResolvedValue('session-uuid-1');
  mockedGetSession.mockReturnValue({ linearSessionId: 'session-uuid-1' } as any);
  mockedPostToDiscord.mockResolvedValue('discord-msg-id');

  // Clear bus listeners to avoid double-registration
  bus.off('agent:spawned');
  bus.off('agent:failed');
  bus.off('agent:suspended');
  bus.off('agent:resumed');
  bus.off('agent:idle');
  bus.off('agent:completed');
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
    expect(mockedCreateAgentSession).not.toHaveBeenCalled();
  });

  it('skips postmortem-* sessions on failed', async () => {
    await bus.emit('agent:failed', { role: 'ops', issueKey: 'postmortem-123', error: 'err' });
    expect(mockedAddComment).not.toHaveBeenCalled();
    expect(mockedDismissSession).not.toHaveBeenCalled();
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
    expect(mockedDismissSession).not.toHaveBeenCalled();
  });

  it('skips duty sessions on completed', async () => {
    await bus.emit('agent:completed', { role: 'ops', issueKey: 'pulse-daily', handoff: 'done' });
    expect(mockedDismissSession).not.toHaveBeenCalled();
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

// ---- AgentSession Management ----

describe('AgentSession Management', () => {
  it('creates AgentSession on spawned', async () => {
    await bus.emit('agent:spawned', { role: 'engineer', issueKey: 'ANC-1', tmuxSession: 't' });
    expect(mockedGetIssue).toHaveBeenCalledWith('ANC-1');
    expect(mockedCreateAgentSession).toHaveBeenCalledWith('issue-uuid-1', 'engineer');
  });

  it('stores linearSessionId on tracked session after spawn', async () => {
    const tracked: any = {};
    mockedGetSession.mockReturnValue(tracked);
    await bus.emit('agent:spawned', { role: 'engineer', issueKey: 'ANC-1', tmuxSession: 't' });
    expect(tracked.linearSessionId).toBe('session-uuid-1');
  });

  it('dismisses AgentSession on failed', async () => {
    await bus.emit('agent:failed', { role: 'engineer', issueKey: 'ANC-1', error: 'err' });
    expect(mockedDismissSession).toHaveBeenCalledWith('session-uuid-1', 'engineer');
  });

  it('dismisses AgentSession on suspended', async () => {
    await bus.emit('agent:suspended', { role: 'engineer', issueKey: 'ANC-1', reason: 'capacity' });
    expect(mockedDismissSession).toHaveBeenCalledWith('session-uuid-1', 'engineer');
  });

  it('dismisses AgentSession on idle', async () => {
    await bus.emit('agent:idle', { role: 'engineer', issueKey: 'ANC-1' });
    expect(mockedDismissSession).toHaveBeenCalledWith('session-uuid-1', 'engineer');
  });

  it('dismisses AgentSession on completed', async () => {
    await bus.emit('agent:completed', { role: 'engineer', issueKey: 'ANC-1', handoff: '# Done' });
    expect(mockedDismissSession).toHaveBeenCalledWith('session-uuid-1', 'engineer');
  });

  it('creates new AgentSession on resumed', async () => {
    await bus.emit('agent:resumed', { role: 'engineer', issueKey: 'ANC-1', tmuxSession: 't' });
    expect(mockedCreateAgentSession).toHaveBeenCalledWith('issue-uuid-1', 'engineer');
  });

  it('skips dismiss when no linearSessionId', async () => {
    mockedGetSession.mockReturnValue({ linearSessionId: undefined } as any);
    await bus.emit('agent:idle', { role: 'engineer', issueKey: 'ANC-1' });
    expect(mockedDismissSession).not.toHaveBeenCalled();
  });

  it('clears linearSessionId after dismiss', async () => {
    const tracked: any = { linearSessionId: 'session-uuid-1' };
    mockedGetSession.mockReturnValue(tracked);
    await bus.emit('agent:idle', { role: 'engineer', issueKey: 'ANC-1' });
    expect(tracked.linearSessionId).toBeUndefined();
  });
});

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

  it('formats completion summary from handoff', async () => {
    const handoff = '# HANDOFF\n\n## Summary\n\n' + 'x'.repeat(500);
    await bus.emit('agent:completed', { role: 'engineer', issueKey: 'ANC-1', handoff });
    const discordBody = mockedPostToDiscord.mock.calls[0][1];
    // Summary should be extracted and reasonably sized
    expect(discordBody).toContain('ANC-1');
    expect(discordBody).toContain('done');
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
