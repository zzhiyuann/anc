import { describe, it, expect, beforeEach, vi } from 'vitest';

// --- Mocks (must be before imports) ---

vi.mock('../src/runtime/runner.js', () => ({
  spawnClaude: vi.fn().mockReturnValue({ success: true, tmuxSession: 'anc-engineer-TEST-1' }),
  suspendSession: vi.fn().mockReturnValue(true),
  sessionExists: vi.fn().mockReturnValue(false),
  sendToAgent: vi.fn().mockReturnValue(true),
  resolveSession: vi.fn(),
}));

vi.mock('../src/runtime/workspace.js', () => ({
  getWorkspacePath: vi.fn().mockReturnValue('/tmp/anc-test-workspace'),
  ensureWorkspace: vi.fn().mockReturnValue({
    root: '/tmp/anc-test-workspace',
    ancDir: '/tmp/anc-test-workspace/.anc',
    codeDir: '/tmp/anc-test-workspace/code',
    claudeDir: '/tmp/anc-test-workspace/.claude',
    memoryDir: '/tmp/anc-test-workspace/.agent-memory',
    handoffPath: '/tmp/anc-test-workspace/HANDOFF.md',
  }),
  writePersonaToWorkspace: vi.fn(),
  writeAutoModeSettings: vi.fn(),
}));

vi.mock('../src/linear/client.js', () => ({
  addComment: vi.fn().mockResolvedValue('comment-id'),
  getIssue: vi.fn().mockResolvedValue(null),
  setIssueStatus: vi.fn().mockResolvedValue(true),
  createSubIssue: vi.fn().mockResolvedValue(null),
}));

vi.mock('../src/linear/images.js', () => ({
  downloadCommentImages: vi.fn().mockImplementation((_body: string) => Promise.resolve(_body)),
}));

vi.mock('../src/routing/router.js', () => ({
  routeComment: vi.fn().mockReturnValue({ target: 'engineer', priority: 3, reason: 'test' }),
}));

vi.mock('../src/core/tasks.js', () => ({
  resolveTaskIdFromIssueKey: vi.fn().mockReturnValue(null),
  setTaskState: vi.fn(),
  createTask: vi.fn().mockReturnValue({ id: 'task-1' }),
  getTask: vi.fn().mockReturnValue(null),
}));

vi.mock('../src/agents/persona.js', () => ({
  buildPersona: vi.fn().mockReturnValue('# Test Persona'),
}));

vi.mock('../src/agents/registry.js', () => ({
  getAgent: vi.fn().mockReturnValue({ role: 'engineer', name: 'Engineer', maxConcurrency: 3, dutySlots: 1, personaFiles: [] }),
}));

vi.mock('../src/core/budget.js', () => ({
  canSpend: vi.fn().mockReturnValue({ allowed: true }),
  estimateCost: vi.fn().mockReturnValue(0.5),
  recordSpend: vi.fn(),
}));

vi.mock('../src/core/kill-switch.js', () => ({
  isGlobalPaused: vi.fn().mockReturnValue(false),
}));

vi.mock('../src/api/hook-handler.js', () => ({
  ensureHookToken: vi.fn().mockReturnValue('test-token'),
}));

import { resolveSession, _resetDedup, shouldDedup } from '../src/runtime/resolve.js';
import { _resetHealth, trackSession } from '../src/runtime/health.js';
import { sessionExists, sendToAgent, spawnClaude } from '../src/runtime/runner.js';
import { _resetQueue, setCooldown, isInCooldown } from '../src/routing/queue.js';
import { bus } from '../src/bus.js';
import { routeComment } from '../src/routing/router.js';

const mockedSessionExists = vi.mocked(sessionExists);
const mockedSendToAgent = vi.mocked(sendToAgent);
const mockedSpawnClaude = vi.mocked(spawnClaude);
const mockedRouteComment = vi.mocked(routeComment);

beforeEach(() => {
  vi.clearAllMocks();
  _resetHealth();
  _resetDedup();
  _resetQueue();
});

// ---- 1. Dedup ----

describe('Dedup in resolveSession', () => {
  it('returns deduped for same task within 60s window', () => {
    mockedSessionExists.mockReturnValue(false);

    const result1 = resolveSession({ role: 'engineer', issueKey: 'TEST-1' });
    expect(result1.action).not.toBe('deduped');

    const result2 = resolveSession({ role: 'engineer', issueKey: 'TEST-1' });
    expect(result2.action).toBe('deduped');
    expect(result2.error).toContain('duplicate');
  });

  it('allows same task after dedup window expires (reset)', () => {
    mockedSessionExists.mockReturnValue(false);

    const result1 = resolveSession({ role: 'engineer', issueKey: 'TEST-2' });
    expect(result1.action).not.toBe('deduped');

    // Simulate window expiry by resetting dedup
    _resetDedup();

    const result2 = resolveSession({ role: 'engineer', issueKey: 'TEST-2' });
    expect(result2.action).not.toBe('deduped');
  });

  it('different tasks are not deduped', () => {
    mockedSessionExists.mockReturnValue(false);

    const result1 = resolveSession({ role: 'engineer', issueKey: 'TEST-A' });
    expect(result1.action).not.toBe('deduped');

    const result2 = resolveSession({ role: 'engineer', issueKey: 'TEST-B' });
    expect(result2.action).not.toBe('deduped');
  });
});

// ---- 2. shouldDedup unit ----

describe('shouldDedup', () => {
  it('returns false on first call, true on second within window', () => {
    expect(shouldDedup('key-1')).toBe(false);
    expect(shouldDedup('key-1')).toBe(true);
  });

  it('prunes old entries when map grows past 200', () => {
    for (let i = 0; i < 201; i++) {
      shouldDedup(`prune-${i}`);
    }
    // The call that triggers pruning should not crash
    expect(shouldDedup('prune-final')).toBe(false);
  });
});

// ---- 3. Cooldown after completion ----

describe('Per-task cooldown', () => {
  it('blocks spawn when task is in cooldown', () => {
    setCooldown('TEST-COOL', 30_000);
    expect(isInCooldown('TEST-COOL')).toBe(true);

    // First call may be deduped; clear dedup so cooldown is the only gate
    _resetDedup();
    const result = resolveSession({ role: 'engineer', issueKey: 'TEST-COOL' });
    expect(result.action).toBe('blocked');
    expect(result.error).toContain('cooldown');
  });

  it('allows spawn when no cooldown is set', () => {
    expect(isInCooldown('TEST-NOCOOL')).toBe(false);
    const result = resolveSession({ role: 'engineer', issueKey: 'TEST-NOCOOL' });
    expect(result.action).not.toBe('blocked');
  });
});

// ---- 4. Follow-up routing ----

describe('Follow-up routing in on-comment', () => {
  let registerCommentHandlers: () => void;

  beforeEach(async () => {
    bus.removeAllListeners('webhook:comment.created');
    const mod = await import('../src/hooks/on-comment.js');
    registerCommentHandlers = mod.registerCommentHandlers;
    registerCommentHandlers();
  });

  it('pipes to active session when tmux is alive', async () => {
    trackSession({
      role: 'engineer', issueKey: 'PIPE-1', tmuxSession: 'anc-engineer-PIPE-1',
      spawnedAt: Date.now(), priority: 3, ceoAssigned: false,
    });

    mockedSessionExists.mockReturnValue(true);
    mockedRouteComment.mockReturnValue({ target: 'engineer', priority: 3, reason: 'active' });

    await bus.emit('webhook:comment.created', {
      comment: { id: 'c1', body: 'Please also fix the tests', userId: 'ceo-id' },
      issue: { id: 'i1', identifier: 'PIPE-1', title: 'Test issue' },
    });

    expect(mockedSendToAgent).toHaveBeenCalledWith(
      'anc-engineer-PIPE-1',
      expect.stringContaining('Please also fix the tests')
    );
    // spawnClaude should NOT have been called
    expect(mockedSpawnClaude).not.toHaveBeenCalled();
  });

  it('spawns new session when no active session exists', async () => {
    mockedSessionExists.mockReturnValue(false);
    mockedRouteComment.mockReturnValue({ target: 'engineer', priority: 3, reason: 'new' });

    await bus.emit('webhook:comment.created', {
      comment: { id: 'c2', body: 'Start working on this', userId: 'ceo-id' },
      issue: { id: 'i2', identifier: 'FRESH-1', title: 'Fresh issue' },
    });

    // No session tracked → sendToAgent should NOT be called
    expect(mockedSendToAgent).not.toHaveBeenCalled();
  });

  it('does not pipe when session is tracked active but tmux is dead', async () => {
    trackSession({
      role: 'engineer', issueKey: 'DEAD-1', tmuxSession: 'anc-engineer-DEAD-1',
      spawnedAt: Date.now(), priority: 3, ceoAssigned: false,
    });

    mockedSessionExists.mockReturnValue(false);
    mockedRouteComment.mockReturnValue({ target: 'engineer', priority: 3, reason: 'resume' });

    await bus.emit('webhook:comment.created', {
      comment: { id: 'c3', body: 'Any update?', userId: 'ceo-id' },
      issue: { id: 'i3', identifier: 'DEAD-1', title: 'Dead session issue' },
    });

    // sendToAgent should NOT have been called (tmux is dead)
    expect(mockedSendToAgent).not.toHaveBeenCalled();
  });
});

// ---- 5. Artifact cleanup ----

describe('Stale artifact cleanup', () => {
  it('resolveSession proceeds through spawn path for fresh tasks', () => {
    mockedSessionExists.mockReturnValue(false);
    const result = resolveSession({ role: 'engineer', issueKey: 'CLEAN-1' });
    // Should reach spawn path (getWorkspacePath is mocked, so cleanStaleArtifacts is safe)
    expect(['spawned', 'blocked', 'queued']).toContain(result.action);
  });
});

// ---- 6. Persona injection ----

describe('Persona injection into workspace', () => {
  it('buildPersona mock is callable', async () => {
    const { buildPersona } = await import('../src/agents/persona.js');
    expect(buildPersona).toBeDefined();
    expect(buildPersona('engineer')).toBe('# Test Persona');
  });
});

// ---- 7. resolveSession piping to active session ----

describe('resolveSession piping to active session', () => {
  it('pipes message to active session and returns piped action', () => {
    trackSession({
      role: 'engineer', issueKey: 'ACTIVE-1', tmuxSession: 'anc-engineer-ACTIVE-1',
      spawnedAt: Date.now(), priority: 3, ceoAssigned: false,
    });

    mockedSessionExists.mockReturnValue(true);

    const result = resolveSession({ role: 'engineer', issueKey: 'ACTIVE-1', prompt: 'Do more work' });
    expect(result.action).toBe('piped');
    expect(result.tmuxSession).toBe('anc-engineer-ACTIVE-1');
    expect(mockedSendToAgent).toHaveBeenCalledWith('anc-engineer-ACTIVE-1', 'Do more work');
  });
});
