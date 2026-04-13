/**
 * Tests for interactive-mode completion detection.
 *
 * Validates that the Stop hook correctly detects when an agent has finished
 * work in interactive mode (tmux alive) by checking for HANDOFF.md or
 * completion phrases in last_assistant_message.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

// --- Mocks (must be before imports) ---

const mockGetDb = vi.fn(() => ({
  prepare: vi.fn(() => ({
    run: vi.fn(),
    get: vi.fn(),
  })),
}));

vi.mock('../src/core/db.js', () => ({
  getDb: () => mockGetDb(),
  initDb: vi.fn(),
}));

vi.mock('../src/bus.js', () => ({
  bus: { emit: vi.fn(), on: vi.fn() },
}));

const mockAddComment = vi.fn(async () => 'comment-123');
const mockGetIssue = vi.fn(async () => ({
  id: 'issue-id-1',
  identifier: 'RYA-1',
  parentId: null,
}));
const mockSetIssueStatus = vi.fn(async () => true);
const mockCreateSubIssue = vi.fn(async () => null);

vi.mock('../src/linear/client.js', () => ({
  addComment: (...args: unknown[]) => mockAddComment(...args),
  getIssue: (...args: unknown[]) => mockGetIssue(...args),
  setIssueStatus: (...args: unknown[]) => mockSetIssueStatus(...args),
  createSubIssue: (...args: unknown[]) => mockCreateSubIssue(...args),
}));

const mockResolveSession = vi.fn();
const mockSendToAgent = vi.fn(() => true);
const mockSessionExists = vi.fn(() => true);

vi.mock('../src/runtime/runner.js', () => ({
  resolveSession: (...args: unknown[]) => mockResolveSession(...args),
  sendToAgent: (...args: unknown[]) => mockSendToAgent(...args),
  sessionExists: (...args: unknown[]) => mockSessionExists(...args),
}));

let testWorkspaceBase: string;
vi.mock('../src/runtime/workspace.js', () => ({
  getWorkspacePath: (issueKey: string) => join(testWorkspaceBase, issueKey),
}));

const mockResolveTaskId = vi.fn((key: string | null | undefined) => key ? `task-${key}` : null);
const mockSetTaskState = vi.fn();
const mockGetTask = vi.fn((id: string) => ({
  id,
  state: 'running',
  title: 'Test task',
  projectId: null,
}));
const mockAddTaskComment = vi.fn(() => 1);
const mockCreateTask = vi.fn((input: Record<string, unknown>) => ({
  id: `child-${randomUUID()}`,
  ...input,
}));
const mockUpdateTask = vi.fn();

vi.mock('../src/core/tasks.js', () => ({
  resolveTaskIdFromIssueKey: (...args: unknown[]) => mockResolveTaskId(...args),
  setTaskState: (...args: unknown[]) => mockSetTaskState(...args),
  getTask: (...args: unknown[]) => mockGetTask(...args),
  addTaskComment: (...args: unknown[]) => mockAddTaskComment(...args),
  createTask: (...args: unknown[]) => mockCreateTask(...args),
  updateTask: (...args: unknown[]) => mockUpdateTask(...args),
}));

vi.mock('../src/core/budget.js', () => ({
  recordSpend: vi.fn(),
  estimateCost: vi.fn(() => 0.01),
}));

vi.mock('../src/routing/queue.js', () => ({
  setCooldown: vi.fn(),
}));

vi.mock('../src/core/notifications.js', () => ({
  createNotification: vi.fn(),
}));

vi.mock('../src/core/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('../src/core/pricing.js', () => ({
  computeCost: vi.fn(() => 0),
  totalTokens: vi.fn(() => 0),
}));

vi.mock('../src/agents/registry.js', () => ({
  _resetRegistry: vi.fn(),
  isKnownRole: vi.fn(() => true),
}));

vi.mock('../src/runtime/health.js', () => ({
  getTrackedSessions: vi.fn(() => [
    {
      role: 'engineer',
      issueKey: 'RYA-1',
      tmuxSession: 'anc-engineer-RYA-1',
      state: 'active',
      spawnedAt: Date.now() - 120_000,
      handoffProcessed: false,
    },
  ]),
  getSessionForIssue: vi.fn((key: string) => ({
    role: 'engineer',
    issueKey: key,
    tmuxSession: `anc-engineer-${key}`,
    state: 'active',
    spawnedAt: Date.now() - 120_000,
    handoffProcessed: false,
  })),
  markIdle: vi.fn(() => true),
}));

// Import after mocks
import { checkActiveCompletion } from '../src/api/hook-handler.js';
import type { ClaudeHookEvent } from '../src/api/hook-handler.js';

describe('Interactive Completion Detection', () => {
  beforeEach(() => {
    testWorkspaceBase = join(tmpdir(), `anc-test-${randomUUID()}`);
    mkdirSync(testWorkspaceBase, { recursive: true });
    vi.clearAllMocks();
  });

  afterEach(() => {
    try {
      rmSync(testWorkspaceBase, { recursive: true, force: true });
    } catch { /**/ }
  });

  it('processes HANDOFF.md when Stop event fires and file exists', async () => {
    const issueKey = 'RYA-1';
    const workspace = join(testWorkspaceBase, issueKey);
    mkdirSync(workspace, { recursive: true });
    writeFileSync(
      join(workspace, 'HANDOFF.md'),
      '# HANDOFF\n\n## Summary\nImplemented feature X with tests. All verified and passing.\n\n## Verification\nAll tests pass. Verified manually.',
    );

    const event: ClaudeHookEvent = {
      hook_event_name: 'Stop',
      stop_hook_active: false,
      last_assistant_message: 'I have completed the task.',
    };

    await checkActiveCompletion(issueKey, 'engineer', event);

    // Should have called Linear setIssueStatus (via processHandoff)
    expect(mockSetIssueStatus).toHaveBeenCalled();
    // Should have posted a comment
    expect(mockAddComment).toHaveBeenCalled();
    // Should have set task state
    expect(mockSetTaskState).toHaveBeenCalled();
  });

  it('sends nudge when agent says completion phrase but no HANDOFF.md', async () => {
    const issueKey = 'RYA-2';
    const workspace = join(testWorkspaceBase, issueKey);
    mkdirSync(workspace, { recursive: true });
    // No HANDOFF.md written

    const event: ClaudeHookEvent = {
      hook_event_name: 'Stop',
      stop_hook_active: false,
      last_assistant_message: 'I\'ve finished the implementation. All done!',
    };

    await checkActiveCompletion(issueKey, 'engineer', event);

    // Should have sent a nudge via sendToAgent
    expect(mockSendToAgent).toHaveBeenCalledTimes(1);
    expect(mockSendToAgent).toHaveBeenCalledWith(
      `anc-engineer-${issueKey}`,
      expect.stringContaining('HANDOFF.md'),
    );
    // Should NOT have called processHandoff (no HANDOFF.md)
    expect(mockSetIssueStatus).not.toHaveBeenCalled();
  });

  it('does nothing when stop_hook_active is true (mid-tool-call)', async () => {
    const issueKey = 'RYA-3';
    const workspace = join(testWorkspaceBase, issueKey);
    mkdirSync(workspace, { recursive: true });
    writeFileSync(join(workspace, 'HANDOFF.md'), '# HANDOFF\n## Summary\nDone.\n## Verification\nPassed.');

    const event: ClaudeHookEvent = {
      hook_event_name: 'Stop',
      stop_hook_active: true,
      last_assistant_message: 'I have completed the task.',
    };

    await checkActiveCompletion(issueKey, 'engineer', event);

    // Should not process anything — agent is mid-tool-call
    expect(mockSetIssueStatus).not.toHaveBeenCalled();
    expect(mockSendToAgent).not.toHaveBeenCalled();
  });

  it('does nothing for non-Stop events', async () => {
    const event: ClaudeHookEvent = {
      hook_event_name: 'PostToolUse',
      tool_name: 'Bash',
    };

    await checkActiveCompletion('RYA-4', 'engineer', event);

    expect(mockSetIssueStatus).not.toHaveBeenCalled();
    expect(mockSendToAgent).not.toHaveBeenCalled();
  });

  it('does not re-process if task is already in review state', async () => {
    const issueKey = 'RYA-5';
    const workspace = join(testWorkspaceBase, issueKey);
    mkdirSync(workspace, { recursive: true });
    writeFileSync(join(workspace, 'HANDOFF.md'), '# HANDOFF\n## Summary\nDone.\n## Verification\nPassed.');

    // Task already in review
    mockGetTask.mockReturnValueOnce({
      id: `task-${issueKey}`,
      state: 'review',
      title: 'Test task',
      projectId: null,
    });

    const event: ClaudeHookEvent = {
      hook_event_name: 'Stop',
      stop_hook_active: false,
      last_assistant_message: 'Done.',
    };

    await checkActiveCompletion(issueKey, 'engineer', event);

    // Should NOT process — already in review
    expect(mockSetIssueStatus).not.toHaveBeenCalled();
  });

  it('does not nudge when message has no completion phrases', async () => {
    const issueKey = 'RYA-6';
    const workspace = join(testWorkspaceBase, issueKey);
    mkdirSync(workspace, { recursive: true });

    const event: ClaudeHookEvent = {
      hook_event_name: 'Stop',
      stop_hook_active: false,
      last_assistant_message: 'I found an interesting pattern in the code. Let me continue investigating.',
    };

    await checkActiveCompletion(issueKey, 'engineer', event);

    expect(mockSendToAgent).not.toHaveBeenCalled();
    expect(mockSetIssueStatus).not.toHaveBeenCalled();
  });

  it('detects multiple completion phrases', async () => {
    const issueKey = 'RYA-7';
    const workspace = join(testWorkspaceBase, issueKey);
    mkdirSync(workspace, { recursive: true });

    const phrases = [
      'task is complete',
      'I\'ve finished everything',
      'I have completed the task',
      'all done now',
      'the work is done',
    ];

    for (const phrase of phrases) {
      vi.clearAllMocks();
      const event: ClaudeHookEvent = {
        hook_event_name: 'Stop',
        stop_hook_active: false,
        last_assistant_message: phrase,
      };

      await checkActiveCompletion(issueKey, 'engineer', event);
      expect(mockSendToAgent).toHaveBeenCalledTimes(1);
    }
  });
});

describe('processHandoff shared function', () => {
  beforeEach(() => {
    testWorkspaceBase = join(tmpdir(), `anc-test-${randomUUID()}`);
    mkdirSync(testWorkspaceBase, { recursive: true });
    vi.clearAllMocks();
  });

  afterEach(() => {
    try {
      rmSync(testWorkspaceBase, { recursive: true, force: true });
    } catch { /**/ }
  });

  it('reads HANDOFF, updates status, creates comment', async () => {
    // Import the shared processor
    const { processHandoff } = await import('../src/hooks/handoff-processor.js');

    const issueKey = 'RYA-10';
    const workspace = join(testWorkspaceBase, issueKey);
    mkdirSync(workspace, { recursive: true });
    const handoffPath = join(workspace, 'HANDOFF.md');
    writeFileSync(
      handoffPath,
      '# HANDOFF\n\n## Summary\nBuilt the widget. All tests green.\n\n## Verification\nAll 42 tests pass.\n\n## Actions\nstatus: In Review',
    );

    const result = await processHandoff({
      issueKey,
      role: 'engineer',
      handoffPath,
      workspace,
      spawnedAt: Date.now() - 300_000,
      markSessionIdle: false,
    });

    expect(result).toBe(true);
    // Linear status should be set
    expect(mockSetIssueStatus).toHaveBeenCalledWith('issue-id-1', 'In Review', 'engineer');
    // Task comment should be posted
    expect(mockAddTaskComment).toHaveBeenCalled();
    // Linear comment should be posted
    expect(mockAddComment).toHaveBeenCalled();
    // Task state should be set to review
    expect(mockSetTaskState).toHaveBeenCalledWith(
      expect.stringContaining('task-'),
      'review',
      expect.any(Number),
    );
    // HANDOFF.md should be archived (renamed)
    expect(existsSync(handoffPath)).toBe(false);
  });
});
