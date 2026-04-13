/**
 * Mention dispatch — POST /tasks/:id/comments must spawn a session for every
 * non-CEO role that appears either (a) in the explicit `mentions` array
 * (string[] OR {role}[]) or (b) as an `@role` token in the comment body.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'http';
import { setFileLogging } from '../src/core/logger.js';

setFileLogging(false);

// --- Mocks ---

const mockAgents = [
  { role: 'engineer', name: 'Engineer', personaFiles: [], maxConcurrency: 5, dutySlots: 1 },
  { role: 'strategist', name: 'Strategist', personaFiles: [], maxConcurrency: 5, dutySlots: 1 },
  { role: 'ops', name: 'Ops', personaFiles: [], maxConcurrency: 5, dutySlots: 1 },
];

vi.mock('../src/agents/registry.js', () => ({
  getRegisteredAgents: vi.fn(() => mockAgents),
  getAgent: vi.fn((role: string) => mockAgents.find(a => a.role === role)),
  _resetRegistry: vi.fn(),
}));

vi.mock('../src/agents/memory.js', () => ({
  listMemories: vi.fn(() => []),
  listSharedMemories: vi.fn(() => []),
}));

vi.mock('../src/runtime/health.js', () => ({
  getTrackedSessions: vi.fn(() => []),
  getHealthStatus: vi.fn(() => ({ activeSessions: 0, idleSessions: 0, suspendedSessions: 0, maxConcurrency: 5, sessions: [] })),
  hasCapacity: vi.fn(() => true),
  getSessionForIssue: vi.fn(() => undefined),
}));

vi.mock('../src/runtime/runner.js', () => ({
  sendToAgent: vi.fn(() => true),
  captureOutput: vi.fn(() => ''),
  killAgent: vi.fn(),
  sessionExists: vi.fn(() => false),
}));

vi.mock('../src/runtime/resolve.js', () => ({
  resolveSession: vi.fn(() => ({ action: 'spawned', tmuxSession: 'anc-test' })),
}));

vi.mock('../src/routing/queue.js', () => ({
  getQueue: vi.fn(() => []),
  cancelItem: vi.fn(),
}));

const fakeDbState = {
  comments: [] as Array<Record<string, unknown>>,
};
const fakeDb = {
  prepare: (sql: string) => {
    const s = sql.replace(/\s+/g, ' ').trim();
    return {
      run: (...args: unknown[]) => {
        if (s.startsWith('INSERT INTO task_comments')) {
          const id = fakeDbState.comments.length + 1;
          fakeDbState.comments.push({
            id,
            task_id: args[0],
            author: args[1],
            body: args[2],
            parent_id: args[3] ?? null,
            created_at: Date.now(),
          });
          return { changes: 1, lastInsertRowid: id };
        }
        return { changes: 0, lastInsertRowid: 0 };
      },
      get: (...args: unknown[]) => {
        if (s.includes('FROM task_comments WHERE id')) {
          return fakeDbState.comments.find(c => c.id === args[0]);
        }
        return undefined;
      },
      all: () => [],
    };
  },
};

vi.mock('../src/core/db.js', () => ({
  getRecentEvents: vi.fn(() => []),
  getDb: vi.fn(() => fakeDb),
}));

const tasksStore = new Map<string, Record<string, unknown>>();
vi.mock('../src/core/tasks.js', () => ({
  createTask: vi.fn(),
  getTask: vi.fn((id: string) => tasksStore.get(id) ?? null),
  listTasks: vi.fn(() => []),
  getTaskChildren: vi.fn(() => []),
  getChildCounts: vi.fn(() => ({})),
  setTaskState: vi.fn(),
  updateTask: vi.fn(),
  resolveTaskIdFromIssueKey: vi.fn((key: string) => key),
  deleteTask: vi.fn(() => true),
}));

vi.mock('../src/core/labels.js', () => ({
  listLabels: vi.fn(() => []),
  getTaskLabels: vi.fn(() => []),
  getLabelsForTasks: vi.fn(() => ({})),
}));

vi.mock('../src/core/notifications.js', () => ({
  createNotification: vi.fn((n: Record<string, unknown>) => ({ ...n, id: 1, createdAt: Date.now() })),
}));

vi.mock('../src/linear/types.js', () => ({
  getConfig: vi.fn(() => ({
    stateDir: '/tmp/anc-test', linearTeamId: 't', linearTeamKey: 'T',
    workspaceBase: '/tmp/ws', webhookPort: 3849,
  })),
}));

import { handleApiRequest } from '../src/api/routes.js';
import { resolveSession } from '../src/runtime/resolve.js';
import { createNotification } from '../src/core/notifications.js';

const mockedResolveSession = vi.mocked(resolveSession);
const mockedCreateNotification = vi.mocked(createNotification);

function createReq(method: string, url: string, body?: Record<string, unknown>): IncomingMessage {
  return {
    method, url, headers: {},
    socket: { remoteAddress: '127.0.0.1' },
    on: vi.fn((event: string, handler: (data?: unknown) => void) => {
      if (event === 'data' && body) handler(Buffer.from(JSON.stringify(body)));
      if (event === 'end') handler();
    }),
  } as unknown as IncomingMessage;
}

function createRes() {
  let status = 200;
  let body = '';
  return {
    writeHead: vi.fn((s: number) => { status = s; }),
    end: vi.fn((b?: string) => { body = b ?? ''; }),
    get _status() { return status; },
    _parsed() { return JSON.parse(body); },
  } as unknown as ServerResponse & { _status: number; _parsed: () => unknown };
}

beforeEach(() => {
  vi.clearAllMocks();
  fakeDbState.comments = [];
  tasksStore.clear();
  tasksStore.set('task-mention-1', {
    id: 'task-mention-1',
    title: 'Test mention',
    description: null,
    state: 'running',
    priority: 3,
    parentTaskId: null,
  });
});

describe('POST /tasks/:id/comments — mention fanout', () => {
  it('dispatches strategist when mentions array is string[]', async () => {
    const req = createReq('POST', '/api/v1/tasks/task-mention-1/comments', {
      body: '@strategist 在吗',
      mentions: ['strategist'],
    });
    const res = createRes();
    await handleApiRequest(req, res);

    expect(res._status).toBe(201);
    expect(mockedResolveSession).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'strategist', taskId: 'task-mention-1' })
    );
    expect(mockedCreateNotification).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'dispatch', agentRole: 'strategist' })
    );
  });

  it('dispatches when mentions array is {role}[] (legacy shape)', async () => {
    const req = createReq('POST', '/api/v1/tasks/task-mention-1/comments', {
      body: 'hey strategist',
      mentions: [{ role: 'strategist' }],
    });
    const res = createRes();
    await handleApiRequest(req, res);

    expect(res._status).toBe(201);
    expect(mockedResolveSession).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'strategist' })
    );
  });

  it('dispatches based on @role token in body even without explicit mentions', async () => {
    const req = createReq('POST', '/api/v1/tasks/task-mention-1/comments', {
      body: 'cc @ops please review',
    });
    const res = createRes();
    await handleApiRequest(req, res);

    expect(res._status).toBe(201);
    expect(mockedResolveSession).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'ops' })
    );
  });

  it('skips @ceo mentions', async () => {
    const req = createReq('POST', '/api/v1/tasks/task-mention-1/comments', {
      body: '@ceo just a note',
      mentions: ['ceo'],
    });
    const res = createRes();
    await handleApiRequest(req, res);

    expect(res._status).toBe(201);
    expect(mockedResolveSession).not.toHaveBeenCalled();
  });

  it('dedupes when same role appears in both array and body', async () => {
    const req = createReq('POST', '/api/v1/tasks/task-mention-1/comments', {
      body: '@strategist hello @strategist',
      mentions: ['strategist'],
    });
    const res = createRes();
    await handleApiRequest(req, res);

    expect(res._status).toBe(201);
    expect(mockedResolveSession).toHaveBeenCalledTimes(1);
  });

  it('returns warnings for unknown roles instead of erroring', async () => {
    const req = createReq('POST', '/api/v1/tasks/task-mention-1/comments', {
      body: '@nobody help',
    });
    const res = createRes();
    await handleApiRequest(req, res);

    expect(res._status).toBe(201);
    const data = res._parsed() as { warnings?: string[] };
    expect(data.warnings).toBeDefined();
    expect(data.warnings?.[0]).toContain('nobody');
    expect(mockedResolveSession).not.toHaveBeenCalled();
  });

  it('dispatches multiple distinct roles in one comment', async () => {
    const req = createReq('POST', '/api/v1/tasks/task-mention-1/comments', {
      body: '@strategist and @ops please coordinate',
    });
    const res = createRes();
    await handleApiRequest(req, res);

    expect(res._status).toBe(201);
    expect(mockedResolveSession).toHaveBeenCalledTimes(2);
    const roles = mockedResolveSession.mock.calls.map(c => c[0].role);
    expect(roles).toContain('strategist');
    expect(roles).toContain('ops');
  });
});
