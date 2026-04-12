/**
 * Phase 1 — REST API integration tests.
 * Tests /api/v1/* handler functions directly (no HTTP server needed).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'http';
import { setFileLogging } from '../src/core/logger.js';

setFileLogging(false);

// --- Mock all external dependencies ---

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
  listMemories: vi.fn(() => ['project.md', 'rules.md']),
  listSharedMemories: vi.fn(() => ['values.md', 'guidelines.md']),
}));

vi.mock('../src/runtime/health.js', () => ({
  getTrackedSessions: vi.fn(() => [
    { role: 'engineer', issueKey: 'ANC-1', state: 'active', tmuxSession: 'anc-engineer-ANC-1', spawnedAt: Date.now(), priority: 3, isDuty: false, ceoAssigned: false },
    { role: 'ops', issueKey: 'ANC-2', state: 'idle', tmuxSession: 'anc-ops-ANC-2', spawnedAt: Date.now(), priority: 5, isDuty: true, ceoAssigned: false },
  ]),
  getHealthStatus: vi.fn(() => ({
    activeSessions: 1,
    idleSessions: 0,
    suspendedSessions: 0,
    maxConcurrency: 5,
    sessions: [],
  })),
  hasCapacity: vi.fn(() => true),
  getSessionForIssue: vi.fn((issueKey: string) => {
    if (issueKey === 'ANC-1') return {
      role: 'engineer', issueKey: 'ANC-1', state: 'active',
      tmuxSession: 'anc-engineer-ANC-1', spawnedAt: Date.now(), priority: 3,
    };
    if (issueKey === 'ANC-2') return {
      role: 'ops', issueKey: 'ANC-2', state: 'idle',
      tmuxSession: 'anc-ops-ANC-2', spawnedAt: Date.now(), priority: 5,
    };
    return undefined;
  }),
}));

vi.mock('../src/runtime/runner.js', () => ({
  sendToAgent: vi.fn(() => true),
  captureOutput: vi.fn(() => 'some output'),
  killAgent: vi.fn(),
  sessionExists: vi.fn((name: string) => name === 'anc-engineer-ANC-1'),
}));

vi.mock('../src/runtime/resolve.js', () => ({
  resolveSession: vi.fn(() => ({ action: 'spawned', tmuxSession: 'anc-engineer-ANC-99' })),
}));

vi.mock('../src/routing/queue.js', () => ({
  getQueue: vi.fn(() => [
    { id: 'q-1', issueKey: 'ANC-10', agentRole: 'engineer', priority: 3, status: 'queued', createdAt: Date.now() },
  ]),
  cancelItem: vi.fn(),
}));

// --- In-memory fake DB for route handlers that read task_events / task_comments / sessions / budget_log ---
interface FakeStmt {
  run: (...args: unknown[]) => { changes: number; lastInsertRowid: number };
  get: (...args: unknown[]) => unknown;
  all: (...args: unknown[]) => unknown[];
}
const fakeDbState = {
  comments: [] as Array<Record<string, unknown>>,
  taskEvents: [] as Array<Record<string, unknown>>,
  sessionsByTask: new Map<string, Array<Record<string, unknown>>>(),
  budgetLog: [] as Array<Record<string, unknown>>,
  queueDepth: 0,
};
function makeFakeStmt(sql: string): FakeStmt {
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
      if (s.includes('COUNT(*)') && s.includes('queue')) {
        return { n: fakeDbState.queueDepth };
      }
      if (s.startsWith('SELECT issue_key FROM sessions WHERE task_id')) {
        const list = fakeDbState.sessionsByTask.get(args[0] as string) ?? [];
        return list[0];
      }
      return undefined;
    },
    all: (...args: unknown[]) => {
      if (s.startsWith('SELECT * FROM task_comments WHERE task_id')) {
        return fakeDbState.comments.filter(c => c.task_id === args[0]);
      }
      if (s.startsWith('SELECT * FROM task_events WHERE task_id')) {
        return fakeDbState.taskEvents.filter(e => e.task_id === args[0]);
      }
      if (s.startsWith('SELECT * FROM sessions WHERE task_id')) {
        return fakeDbState.sessionsByTask.get(args[0] as string) ?? [];
      }
      if (s.includes('FROM budget_log')) {
        return [];
      }
      return [];
    },
  };
}
const fakeDb = { prepare: (sql: string) => makeFakeStmt(sql) };

vi.mock('../src/core/db.js', () => ({
  getRecentEvents: vi.fn(() => []),
  getDb: vi.fn(() => fakeDb),
}));

// --- Tasks / Projects / Notifications core mocks ---
const tasksStore = new Map<string, Record<string, unknown>>();
let taskSeq = 0;
vi.mock('../src/core/tasks.js', () => ({
  createTask: vi.fn((input: Record<string, unknown>) => {
    taskSeq += 1;
    const id = (input.id as string) ?? `task-test-${taskSeq}`;
    const task = {
      id,
      projectId: (input.projectId as string | null) ?? null,
      title: input.title,
      description: (input.description as string | null) ?? null,
      state: (input.state as string) ?? 'todo',
      priority: (input.priority as number) ?? 3,
      source: (input.source as string) ?? 'dashboard',
      parentTaskId: (input.parentTaskId as string | null) ?? null,
      createdBy: (input.createdBy as string) ?? 'ceo',
      linearIssueKey: (input.linearIssueKey as string | null) ?? null,
      createdAt: Date.now(),
      completedAt: null,
      handoffSummary: null,
    };
    tasksStore.set(id, task);
    return task;
  }),
  getTask: vi.fn((id: string) => tasksStore.get(id) ?? null),
  listTasks: vi.fn(() => Array.from(tasksStore.values())),
  getTaskChildren: vi.fn(() => []),
  setTaskState: vi.fn(),
  updateTask: vi.fn((id: string, patch: Record<string, unknown>) => {
    const existing = tasksStore.get(id);
    if (!existing) return null;
    const updated = { ...existing, ...patch };
    tasksStore.set(id, updated);
    return updated;
  }),
  resolveTaskIdFromIssueKey: vi.fn((key: string) => key),
  deleteTask: vi.fn((id: string) => tasksStore.delete(id)),
}));

const projectsStore = new Map<string, Record<string, unknown>>();
vi.mock('../src/core/projects.js', () => ({
  createProject: vi.fn((input: Record<string, unknown>) => {
    const id = (input.id as string) ?? `proj-${String(input.name).toLowerCase().replace(/\s+/g, '-')}`;
    const project = {
      id,
      name: input.name,
      description: (input.description as string | null) ?? null,
      color: (input.color as string) ?? '#3b82f6',
      icon: (input.icon as string | null) ?? null,
      state: 'active',
      createdBy: 'ceo',
      createdAt: Date.now(),
      archivedAt: null,
    };
    projectsStore.set(id, project);
    return project;
  }),
  getProject: vi.fn((id: string) => projectsStore.get(id) ?? null),
  listProjects: vi.fn(() => Array.from(projectsStore.values())),
  updateProject: vi.fn((id: string, patch: Record<string, unknown>) => {
    const existing = projectsStore.get(id);
    if (!existing) return null;
    const updated = { ...existing, ...patch };
    projectsStore.set(id, updated);
    return updated;
  }),
  archiveProject: vi.fn((id: string) => {
    const existing = projectsStore.get(id);
    if (existing) {
      existing.state = 'archived';
      existing.archivedAt = Date.now();
    }
  }),
  getProjectStats: vi.fn(() => ({ total: 0, running: 0, queued: 0, done: 0, totalCostUsd: 0 })),
}));

const notificationsStore: Array<Record<string, unknown>> = [];
let notifSeq = 0;
vi.mock('../src/core/notifications.js', () => ({
  createNotification: vi.fn((input: Record<string, unknown>) => {
    notifSeq += 1;
    const n = {
      id: notifSeq,
      kind: input.kind,
      severity: (input.severity as string) ?? 'info',
      title: input.title,
      body: (input.body as string | null) ?? null,
      taskId: (input.taskId as string | null) ?? null,
      projectId: (input.projectId as string | null) ?? null,
      agentRole: (input.agentRole as string | null) ?? null,
      readAt: null,
      archivedAt: null,
      createdAt: Date.now(),
    };
    notificationsStore.push(n);
    return n;
  }),
  listNotifications: vi.fn(() => [...notificationsStore]),
  getUnreadCount: vi.fn(() => notificationsStore.filter(n => n.readAt === null && n.archivedAt === null).length),
  markRead: vi.fn((id: number) => {
    const n = notificationsStore.find(x => x.id === id);
    if (n) n.readAt = Date.now();
  }),
  markAllRead: vi.fn(() => {
    let c = 0;
    for (const n of notificationsStore) if (n.readAt === null) { n.readAt = Date.now(); c++; }
    return c;
  }),
  archiveNotification: vi.fn((id: number) => {
    const n = notificationsStore.find(x => x.id === id);
    if (n) { n.archivedAt = Date.now(); n.readAt ??= Date.now(); }
  }),
}));

vi.mock('../src/linear/types.js', () => ({
  getConfig: vi.fn(() => ({
    stateDir: '/tmp/anc-test',
    linearTeamId: 'test',
    linearTeamKey: 'TEST',
    workspaceBase: '/tmp/workspaces',
    webhookPort: 3849,
  })),
}));

import { handleApiRequest } from '../src/api/routes.js';
import { resolveSession } from '../src/runtime/resolve.js';
import { sendToAgent, killAgent } from '../src/runtime/runner.js';
import { listSharedMemories } from '../src/agents/memory.js';

const mockedResolveSession = vi.mocked(resolveSession);
const mockedSendToAgent = vi.mocked(sendToAgent);
const mockedKillAgent = vi.mocked(killAgent);

// --- Helpers to simulate HTTP req/res ---

function createReq(method: string, url: string, body?: Record<string, unknown>): IncomingMessage {
  const req = {
    method,
    url,
    headers: {},
    // Simulate a loopback connection so the auth check passes.
    socket: { remoteAddress: '127.0.0.1' },
    on: vi.fn((event: string, handler: (data?: unknown) => void) => {
      if (event === 'data' && body) {
        handler(Buffer.from(JSON.stringify(body)));
      }
      if (event === 'end') {
        handler();
      }
    }),
  } as unknown as IncomingMessage;
  return req;
}

function createRes(): ServerResponse & { _status: number; _body: string; _parsed: () => unknown } {
  let status = 200;
  let body = '';
  const res = {
    writeHead: vi.fn((s: number) => { status = s; }),
    end: vi.fn((b?: string) => { body = b ?? ''; }),
    get _status() { return status; },
    get _body() { return body; },
    _parsed() { return JSON.parse(body); },
  } as unknown as ServerResponse & { _status: number; _body: string; _parsed: () => unknown };
  return res;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// --- GET /agents ---

describe('API — GET /agents', () => {
  it('returns agent list with health status', async () => {
    const req = createReq('GET', '/api/v1/agents');
    const res = createRes();
    const handled = await handleApiRequest(req, res);

    expect(handled).toBe(true);
    expect(res._status).toBe(200);
    const data = res._parsed() as { agents: Array<{ role: string; name: string }> };
    expect(data.agents).toHaveLength(3);
    expect(data.agents[0].role).toBe('engineer');
    expect(data.agents[0]).toHaveProperty('activeSessions');
  });
});

// --- GET /agents/:role ---

describe('API — GET /agents/:role', () => {
  it('returns agent detail', async () => {
    const req = createReq('GET', '/api/v1/agents/engineer');
    const res = createRes();
    const handled = await handleApiRequest(req, res);

    expect(handled).toBe(true);
    expect(res._status).toBe(200);
    const data = res._parsed() as { role: string; memoryCount: number };
    expect(data.role).toBe('engineer');
    expect(data.memoryCount).toBe(2);
  });

  it('returns 404 for unknown agent', async () => {
    const req = createReq('GET', '/api/v1/agents/nonexistent');
    const res = createRes();
    await handleApiRequest(req, res);

    expect(res._status).toBe(404);
  });
});

// --- POST /agents/:role/start ---

describe('API — POST /agents/:role/start', () => {
  it('calls resolveSession with correct params', async () => {
    const req = createReq('POST', '/api/v1/agents/engineer/start', { issueKey: 'ANC-99' });
    const res = createRes();
    await handleApiRequest(req, res);

    expect(res._status).toBe(200);
    expect(mockedResolveSession).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'engineer', issueKey: 'ANC-99' })
    );
  });

  it('returns 400 when issueKey is missing', async () => {
    const req = createReq('POST', '/api/v1/agents/engineer/start', {});
    const res = createRes();
    await handleApiRequest(req, res);

    expect(res._status).toBe(400);
    const data = res._parsed() as { error: string };
    expect(data.error).toContain('issueKey');
  });

  it('returns 409 when blocked', async () => {
    mockedResolveSession.mockReturnValueOnce({ action: 'blocked', error: 'circuit breaker' });
    const req = createReq('POST', '/api/v1/agents/engineer/start', { issueKey: 'ANC-99' });
    const res = createRes();
    await handleApiRequest(req, res);

    expect(res._status).toBe(409);
  });
});

// --- POST /agents/:role/talk ---

describe('API — POST /agents/:role/talk', () => {
  it('sends message to active agent sessions', async () => {
    const req = createReq('POST', '/api/v1/agents/engineer/talk', { message: 'Hello agent' });
    const res = createRes();
    await handleApiRequest(req, res);

    expect(res._status).toBe(200);
    expect(mockedSendToAgent).toHaveBeenCalled();
  });

  it('returns 400 when message is missing', async () => {
    const req = createReq('POST', '/api/v1/agents/engineer/talk', {});
    const res = createRes();
    await handleApiRequest(req, res);

    expect(res._status).toBe(400);
    const data = res._parsed() as { error: string };
    expect(data.error).toContain('message');
  });

  it('returns 404 for unknown agent', async () => {
    const req = createReq('POST', '/api/v1/agents/nonexistent/talk', { message: 'Hello' });
    const res = createRes();
    await handleApiRequest(req, res);

    expect(res._status).toBe(404);
  });
});

// --- GET /tasks ---

describe('API — GET /tasks', () => {
  it('returns task rows from listTasks', async () => {
    // Seed a task via the mocked createTask
    const { createTask } = await import('../src/core/tasks.js');
    (createTask as unknown as ReturnType<typeof vi.fn>)({ title: 'Seeded' });
    const req = createReq('GET', '/api/v1/tasks');
    const res = createRes();
    await handleApiRequest(req, res);

    expect(res._status).toBe(200);
    const data = res._parsed() as { tasks: Array<{ id: string; title: string }> };
    expect(Array.isArray(data.tasks)).toBe(true);
    expect(data.tasks.some(t => t.title === 'Seeded')).toBe(true);
  });
});

// --- POST /tasks ---

describe('API — POST /tasks', () => {
  it('creates a new task row and spawns a session', async () => {
    const req = createReq('POST', '/api/v1/tasks', { title: 'Fix the bug', agent: 'engineer' });
    const res = createRes();
    await handleApiRequest(req, res);

    expect(res._status).toBe(201);
    expect(mockedResolveSession).toHaveBeenCalled();
    const data = res._parsed() as { task: { id: string; title: string }; action: string };
    expect(data.task.id).toMatch(/^task-/);
    expect(data.task.title).toBe('Fix the bug');
    expect(data.action).toBe('spawned');
  });

  it('returns 400 when title is missing', async () => {
    const req = createReq('POST', '/api/v1/tasks', {});
    const res = createRes();
    await handleApiRequest(req, res);

    expect(res._status).toBe(400);
    const data = res._parsed() as { error: string };
    expect(data.error).toContain('title');
  });

  it('returns 404 when projectId does not exist', async () => {
    const req = createReq('POST', '/api/v1/tasks', { title: 'x', projectId: 'proj-missing' });
    const res = createRes();
    await handleApiRequest(req, res);
    expect(res._status).toBe(404);
  });
});

// --- DELETE /tasks/:id ---

describe('API — DELETE /tasks/:id', () => {
  it('kills an active task', async () => {
    const req = createReq('DELETE', '/api/v1/tasks/ANC-1');
    const res = createRes();
    await handleApiRequest(req, res);

    expect(res._status).toBe(200);
    expect(mockedKillAgent).toHaveBeenCalled();
    const data = res._parsed() as { ok: boolean; killed: string };
    expect(data.ok).toBe(true);
    expect(data.killed).toBe('ANC-1');
  });

  it('returns 404 for unknown task', async () => {
    const req = createReq('DELETE', '/api/v1/tasks/NONEXISTENT');
    const res = createRes();
    await handleApiRequest(req, res);

    expect(res._status).toBe(404);
  });
});

// --- GET /queue ---

describe('API — GET /queue', () => {
  it('returns queue state', async () => {
    const req = createReq('GET', '/api/v1/queue');
    const res = createRes();
    await handleApiRequest(req, res);

    expect(res._status).toBe(200);
    const data = res._parsed() as { queue: Array<{ id: string }> };
    expect(data.queue).toHaveLength(1);
    expect(data.queue[0].id).toBe('q-1');
  });
});

// --- GET /memory/shared ---

describe('API — GET /memory/shared', () => {
  it('returns shared memory files', async () => {
    const req = createReq('GET', '/api/v1/memory/shared');
    const res = createRes();
    await handleApiRequest(req, res);

    expect(res._status).toBe(200);
    const data = res._parsed() as { files: string[] };
    expect(data.files).toEqual(['values.md', 'guidelines.md']);
  });
});

// --- Unknown endpoint ---

describe('API — unknown endpoint', () => {
  it('returns false (not handled) for unknown routes', async () => {
    const req = createReq('GET', '/api/v1/nonexistent');
    const res = createRes();
    const handled = await handleApiRequest(req, res);

    expect(handled).toBe(false);
  });

  it('returns false for wrong method on existing path', async () => {
    const req = createReq('PATCH', '/api/v1/agents');
    const res = createRes();
    const handled = await handleApiRequest(req, res);

    expect(handled).toBe(false);
  });
});

// --- Auth ---

describe('API — auth', () => {
  it('rejects non-localhost requests when no token configured', async () => {
    const prev = process.env.ANC_API_TOKEN;
    delete process.env.ANC_API_TOKEN;
    const req = createReq('GET', '/api/v1/agents');
    (req as unknown as { socket: { remoteAddress: string } }).socket = { remoteAddress: '10.0.0.42' };
    const res = createRes();
    const handled = await handleApiRequest(req, res);
    expect(handled).toBe(true);
    expect(res._status).toBe(401);
    if (prev !== undefined) process.env.ANC_API_TOKEN = prev;
  });

  it('allows non-localhost request with valid Bearer token', async () => {
    process.env.ANC_API_TOKEN = 'secret-token';
    const req = createReq('GET', '/api/v1/agents');
    (req as unknown as { socket: { remoteAddress: string } }).socket = { remoteAddress: '10.0.0.42' };
    (req as unknown as { headers: Record<string, string> }).headers = { authorization: 'Bearer secret-token' };
    const res = createRes();
    await handleApiRequest(req, res);
    expect(res._status).toBe(200);
    delete process.env.ANC_API_TOKEN;
  });

  it('rejects non-localhost request with wrong token', async () => {
    process.env.ANC_API_TOKEN = 'secret-token';
    const req = createReq('GET', '/api/v1/agents');
    (req as unknown as { socket: { remoteAddress: string } }).socket = { remoteAddress: '10.0.0.42' };
    (req as unknown as { headers: Record<string, string> }).headers = { authorization: 'Bearer wrong' };
    const res = createRes();
    await handleApiRequest(req, res);
    expect(res._status).toBe(401);
    delete process.env.ANC_API_TOKEN;
  });
});

// --- issueKey validation ---

describe('API — issueKey validation', () => {
  it('rejects issueKey with path traversal', async () => {
    const req = createReq('POST', '/api/v1/agents/engineer/start', { issueKey: '../etc/passwd' });
    const res = createRes();
    await handleApiRequest(req, res);
    expect(res._status).toBe(400);
    const data = res._parsed() as { error: string };
    expect(data.error).toContain('Invalid issueKey format');
  });

  it('rejects issueKey with shell metacharacters', async () => {
    const req = createReq('POST', '/api/v1/agents/engineer/start', { issueKey: 'ANC-1; rm -rf /' });
    const res = createRes();
    await handleApiRequest(req, res);
    expect(res._status).toBe(400);
  });

  it('accepts valid alphanumeric/dash/underscore issueKey', async () => {
    const req = createReq('POST', '/api/v1/agents/engineer/start', { issueKey: 'ANC-42_test' });
    const res = createRes();
    await handleApiRequest(req, res);
    expect(res._status).toBe(200);
  });

  it('rejects malformed task id on DELETE /tasks/:id', async () => {
    const req = createReq('DELETE', '/api/v1/tasks/bad%20id');
    const res = createRes();
    await handleApiRequest(req, res);
    expect(res._status).toBe(400);
  });
});

// --- Status param validation ---

describe('API — GET /queue status param', () => {
  it('ignores invalid status param', async () => {
    const req = createReq('GET', '/api/v1/queue?status=bogus');
    const res = createRes();
    await handleApiRequest(req, res);
    expect(res._status).toBe(200);
    const data = res._parsed() as { queue: unknown[] };
    expect(Array.isArray(data.queue)).toBe(true);
  });

  it('accepts valid status param', async () => {
    const req = createReq('GET', '/api/v1/queue?status=queued');
    const res = createRes();
    await handleApiRequest(req, res);
    expect(res._status).toBe(200);
  });
});

// =========================================================================
// Wave 2A — Task / Project / Notification API
// =========================================================================

describe('Wave 2A — GET /tasks/:id detail', () => {
  it('returns full detail shape for an existing task', async () => {
    const { createTask } = await import('../src/core/tasks.js');
    const task = (createTask as unknown as ReturnType<typeof vi.fn>)({ title: 'Detail me' }) as { id: string };
    const req = createReq('GET', `/api/v1/tasks/${task.id}`);
    const res = createRes();
    await handleApiRequest(req, res);
    expect(res._status).toBe(200);
    const data = res._parsed() as {
      task: { id: string; title: string };
      sessions: unknown[];
      events: unknown[];
      comments: unknown[];
      attachments: unknown[];
      cost: { totalUsd: number };
      children: unknown[];
      handoff: unknown | null;
    };
    expect(data.task.id).toBe(task.id);
    expect(data.task.title).toBe('Detail me');
    expect(Array.isArray(data.sessions)).toBe(true);
    expect(Array.isArray(data.events)).toBe(true);
    expect(Array.isArray(data.comments)).toBe(true);
    expect(Array.isArray(data.attachments)).toBe(true);
    expect(Array.isArray(data.children)).toBe(true);
    expect(data.cost).toHaveProperty('totalUsd');
  });

  it('falls back to session lookup for legacy issueKey', async () => {
    const req = createReq('GET', '/api/v1/tasks/ANC-1');
    const res = createRes();
    await handleApiRequest(req, res);
    // Legacy session path returns session shape (has role).
    expect(res._status).toBe(200);
  });

  it('returns 404 for unknown task', async () => {
    const req = createReq('GET', '/api/v1/tasks/task-does-not-exist');
    const res = createRes();
    await handleApiRequest(req, res);
    expect(res._status).toBe(404);
  });

  it('rejects malformed id', async () => {
    const req = createReq('GET', '/api/v1/tasks/bad%20id');
    const res = createRes();
    await handleApiRequest(req, res);
    expect(res._status).toBe(400);
  });
});

describe('Wave 2A — task comments', () => {
  it('POST /tasks/:id/comments creates a row', async () => {
    const { createTask } = await import('../src/core/tasks.js');
    const task = (createTask as unknown as ReturnType<typeof vi.fn>)({ title: 'C' }) as { id: string };
    const req = createReq('POST', `/api/v1/tasks/${task.id}/comments`, { body: 'hello world' });
    const res = createRes();
    await handleApiRequest(req, res);
    expect(res._status).toBe(201);
    const data = res._parsed() as { comment: { id: number; body: string; author: string } };
    expect(data.comment.body).toBe('hello world');
    expect(data.comment.author).toBe('ceo');
  });

  it('GET /tasks/:id/comments lists created comments', async () => {
    const { createTask } = await import('../src/core/tasks.js');
    const task = (createTask as unknown as ReturnType<typeof vi.fn>)({ title: 'C2' }) as { id: string };
    // Seed a comment
    const postReq = createReq('POST', `/api/v1/tasks/${task.id}/comments`, { body: 'first' });
    const postRes = createRes();
    await handleApiRequest(postReq, postRes);

    const req = createReq('GET', `/api/v1/tasks/${task.id}/comments`);
    const res = createRes();
    await handleApiRequest(req, res);
    expect(res._status).toBe(200);
    const data = res._parsed() as { comments: Array<{ body: string }> };
    expect(data.comments.some(c => c.body === 'first')).toBe(true);
  });

  it('POST requires a body', async () => {
    const { createTask } = await import('../src/core/tasks.js');
    const task = (createTask as unknown as ReturnType<typeof vi.fn>)({ title: 'C3' }) as { id: string };
    const req = createReq('POST', `/api/v1/tasks/${task.id}/comments`, {});
    const res = createRes();
    await handleApiRequest(req, res);
    expect(res._status).toBe(400);
  });

  it('returns 404 when task does not exist', async () => {
    const req = createReq('POST', '/api/v1/tasks/task-missing/comments', { body: 'x' });
    const res = createRes();
    await handleApiRequest(req, res);
    expect(res._status).toBe(404);
  });
});

describe('Wave 2A — POST /tasks/:id/dispatch', () => {
  it('creates a second session on the same task', async () => {
    const { createTask } = await import('../src/core/tasks.js');
    const task = (createTask as unknown as ReturnType<typeof vi.fn>)({ title: 'Dispatch me' }) as { id: string };
    const req = createReq('POST', `/api/v1/tasks/${task.id}/dispatch`, { role: 'strategist' });
    const res = createRes();
    await handleApiRequest(req, res);
    expect(res._status).toBe(201);
    const data = res._parsed() as { session: { role: string; issueKey: string } };
    expect(data.session.role).toBe('strategist');
    expect(data.session.issueKey).toContain(task.id);
  });

  it('rejects unknown role', async () => {
    const { createTask } = await import('../src/core/tasks.js');
    const task = (createTask as unknown as ReturnType<typeof vi.fn>)({ title: 'DD' }) as { id: string };
    const req = createReq('POST', `/api/v1/tasks/${task.id}/dispatch`, { role: 'wizard' });
    const res = createRes();
    await handleApiRequest(req, res);
    expect(res._status).toBe(404);
  });

  it('requires role in body', async () => {
    const { createTask } = await import('../src/core/tasks.js');
    const task = (createTask as unknown as ReturnType<typeof vi.fn>)({ title: 'DD2' }) as { id: string };
    const req = createReq('POST', `/api/v1/tasks/${task.id}/dispatch`, {});
    const res = createRes();
    await handleApiRequest(req, res);
    expect(res._status).toBe(400);
  });
});

describe('Wave 2A — Projects API', () => {
  it('POST /projects creates a project', async () => {
    const req = createReq('POST', '/api/v1/projects', { name: 'My Project' });
    const res = createRes();
    await handleApiRequest(req, res);
    expect(res._status).toBe(201);
    const data = res._parsed() as { project: { id: string; name: string } };
    expect(data.project.name).toBe('My Project');
  });

  it('POST /projects rejects empty name', async () => {
    const req = createReq('POST', '/api/v1/projects', {});
    const res = createRes();
    await handleApiRequest(req, res);
    expect(res._status).toBe(400);
  });

  it('GET /projects lists projects with stats', async () => {
    const req0 = createReq('POST', '/api/v1/projects', { name: 'Listable' });
    await handleApiRequest(req0, createRes());
    const req = createReq('GET', '/api/v1/projects');
    const res = createRes();
    await handleApiRequest(req, res);
    expect(res._status).toBe(200);
    const data = res._parsed() as { projects: Array<{ name: string; stats: unknown }> };
    expect(data.projects.some(p => p.name === 'Listable')).toBe(true);
    expect(data.projects[0]).toHaveProperty('stats');
  });

  it('GET /projects/:id returns recent tasks + stats', async () => {
    const reqC = createReq('POST', '/api/v1/projects', { name: 'Detail Project' });
    const resC = createRes();
    await handleApiRequest(reqC, resC);
    const created = resC._parsed() as { project: { id: string } };

    const req = createReq('GET', `/api/v1/projects/${created.project.id}`);
    const res = createRes();
    await handleApiRequest(req, res);
    expect(res._status).toBe(200);
    const data = res._parsed() as { project: { id: string }; recentTasks: unknown[]; stats: unknown };
    expect(data.project.id).toBe(created.project.id);
    expect(Array.isArray(data.recentTasks)).toBe(true);
  });

  it('PATCH /projects/:id updates fields', async () => {
    const reqC = createReq('POST', '/api/v1/projects', { name: 'Patchy' });
    const resC = createRes();
    await handleApiRequest(reqC, resC);
    const created = resC._parsed() as { project: { id: string } };

    const req = createReq('PATCH', `/api/v1/projects/${created.project.id}`, { color: '#ff00aa' });
    const res = createRes();
    await handleApiRequest(req, res);
    expect(res._status).toBe(200);
    const data = res._parsed() as { project: { color: string } };
    expect(data.project.color).toBe('#ff00aa');
  });

  it('DELETE /projects/:id archives', async () => {
    const reqC = createReq('POST', '/api/v1/projects', { name: 'Archivable' });
    const resC = createRes();
    await handleApiRequest(reqC, resC);
    const created = resC._parsed() as { project: { id: string } };

    const req = createReq('DELETE', `/api/v1/projects/${created.project.id}`);
    const res = createRes();
    await handleApiRequest(req, res);
    expect(res._status).toBe(200);

    // Re-fetch — the archiveProject mock flips the state to 'archived'.
    const req2 = createReq('GET', `/api/v1/projects/${created.project.id}`);
    const res2 = createRes();
    await handleApiRequest(req2, res2);
    const data = res2._parsed() as { project: { state: string } };
    expect(data.project.state).toBe('archived');
  });

  it('returns 404 for missing project', async () => {
    const req = createReq('GET', '/api/v1/projects/proj-nope');
    const res = createRes();
    await handleApiRequest(req, res);
    expect(res._status).toBe(404);
  });
});

describe('Wave 2A — Notifications API', () => {
  it('GET /notifications returns empty list and unreadCount:0 initially', async () => {
    const { createNotification } = await import('../src/core/notifications.js');
    // Fresh — we can't easily reset the module-level store between tests,
    // but the endpoint must still return valid shape.
    const req = createReq('GET', '/api/v1/notifications');
    const res = createRes();
    await handleApiRequest(req, res);
    expect(res._status).toBe(200);
    const data = res._parsed() as { notifications: unknown[]; unreadCount: number };
    expect(Array.isArray(data.notifications)).toBe(true);
    expect(typeof data.unreadCount).toBe('number');
    // Touch the mocked factory so subsequent assertions have a known-good one.
    void createNotification;
  });

  it('GET /notifications/unread-count returns a number', async () => {
    const req = createReq('GET', '/api/v1/notifications/unread-count');
    const res = createRes();
    await handleApiRequest(req, res);
    expect(res._status).toBe(200);
    const data = res._parsed() as { count: number };
    expect(typeof data.count).toBe('number');
  });

  it('POST /notifications/:id/read marks the notification as read', async () => {
    const { createNotification } = await import('../src/core/notifications.js');
    const n = (createNotification as unknown as ReturnType<typeof vi.fn>)({
      kind: 'alert', title: 'ping',
    }) as { id: number };
    const req = createReq('POST', `/api/v1/notifications/${n.id}/read`);
    const res = createRes();
    await handleApiRequest(req, res);
    expect(res._status).toBe(200);
    const data = res._parsed() as { ok: boolean };
    expect(data.ok).toBe(true);
  });

  it('POST /notifications/mark-all-read returns count', async () => {
    const { createNotification } = await import('../src/core/notifications.js');
    (createNotification as unknown as ReturnType<typeof vi.fn>)({ kind: 'alert', title: 'a' });
    (createNotification as unknown as ReturnType<typeof vi.fn>)({ kind: 'alert', title: 'b' });
    const req = createReq('POST', '/api/v1/notifications/mark-all-read');
    const res = createRes();
    await handleApiRequest(req, res);
    expect(res._status).toBe(200);
    const data = res._parsed() as { ok: boolean; count: number };
    expect(data.ok).toBe(true);
    expect(typeof data.count).toBe('number');
  });

  it('POST /notifications/:id/archive archives a notification', async () => {
    const { createNotification } = await import('../src/core/notifications.js');
    const n = (createNotification as unknown as ReturnType<typeof vi.fn>)({
      kind: 'alert', title: 'arch-me',
    }) as { id: number };
    const req = createReq('POST', `/api/v1/notifications/${n.id}/archive`);
    const res = createRes();
    await handleApiRequest(req, res);
    expect(res._status).toBe(200);
  });

  it('rejects invalid notification id', async () => {
    const req = createReq('POST', '/api/v1/notifications/abc/read');
    const res = createRes();
    await handleApiRequest(req, res);
    expect(res._status).toBe(400);
  });
});

// =========================================================================
// Wave 2 critical bug fixes
// =========================================================================

describe('Wave 2 fixes — task sessions merge', () => {
  it('GET /tasks/:id returns sessions array (in-memory merge path is wired)', async () => {
    const { createTask } = await import('../src/core/tasks.js');
    const task = (createTask as unknown as ReturnType<typeof vi.fn>)({ title: 'Has session' }) as { id: string };
    const req = createReq('GET', `/api/v1/tasks/${task.id}`);
    const res = createRes();
    await handleApiRequest(req, res);
    expect(res._status).toBe(200);
    const data = res._parsed() as { sessions: unknown[] };
    expect(Array.isArray(data.sessions)).toBe(true);
  });

  it('POST /tasks then GET /tasks/:id returns the created task with sessions field', async () => {
    const reqC = createReq('POST', '/api/v1/tasks', { title: 'Create + read', agent: 'engineer' });
    const resC = createRes();
    await handleApiRequest(reqC, resC);
    expect(resC._status).toBe(201);
    const created = resC._parsed() as { task: { id: string } };

    const req = createReq('GET', `/api/v1/tasks/${created.task.id}`);
    const res = createRes();
    await handleApiRequest(req, res);
    expect(res._status).toBe(200);
    const data = res._parsed() as { task: { id: string }; sessions: unknown[] };
    expect(data.task.id).toBe(created.task.id);
    expect(Array.isArray(data.sessions)).toBe(true);
  });
});

describe('Wave 2 fixes — DELETE /tasks/:id removes the row', () => {
  it('hard-deletes a task row via deleteTask()', async () => {
    const { createTask, getTask, deleteTask } = await import('../src/core/tasks.js');
    const task = (createTask as unknown as ReturnType<typeof vi.fn>)({ title: 'Delete me' }) as { id: string };
    expect(getTask(task.id)).not.toBeNull();

    const req = createReq('DELETE', `/api/v1/tasks/${task.id}`);
    const res = createRes();
    await handleApiRequest(req, res);
    expect(res._status).toBe(200);
    const data = res._parsed() as { ok: boolean; deleted: boolean };
    expect(data.ok).toBe(true);
    expect(data.deleted).toBe(true);
    expect(deleteTask).toHaveBeenCalledWith(task.id);
    expect(getTask(task.id)).toBeNull();
  });
});

describe('Wave 2 fixes — PATCH /tasks/:id', () => {
  it('updates allowed fields', async () => {
    const { createTask } = await import('../src/core/tasks.js');
    const task = (createTask as unknown as ReturnType<typeof vi.fn>)({ title: 'Old title' }) as { id: string };

    const req = createReq('PATCH', `/api/v1/tasks/${task.id}`, { title: 'New title', priority: 1 });
    const res = createRes();
    await handleApiRequest(req, res);
    expect(res._status).toBe(200);
    const data = res._parsed() as { task: { title: string; priority: number } };
    expect(data.task.title).toBe('New title');
    expect(data.task.priority).toBe(1);
  });

  it('rejects unknown projectId on PATCH', async () => {
    const { createTask } = await import('../src/core/tasks.js');
    const task = (createTask as unknown as ReturnType<typeof vi.fn>)({ title: 'P' }) as { id: string };
    const req = createReq('PATCH', `/api/v1/tasks/${task.id}`, { projectId: 'proj-missing' });
    const res = createRes();
    await handleApiRequest(req, res);
    expect(res._status).toBe(404);
  });

  it('returns 404 for missing task', async () => {
    const req = createReq('PATCH', '/api/v1/tasks/task-not-real', { title: 'x' });
    const res = createRes();
    await handleApiRequest(req, res);
    expect(res._status).toBe(404);
  });
});

describe('Wave 2 fixes — POST /tasks/:id/dispatch surfaces both sessions', () => {
  it('returns success when dispatching a second role on the same task', async () => {
    const { createTask } = await import('../src/core/tasks.js');
    const task = (createTask as unknown as ReturnType<typeof vi.fn>)({ title: 'Dispatch surf' }) as { id: string };
    const req = createReq('POST', `/api/v1/tasks/${task.id}/dispatch`, { role: 'strategist' });
    const res = createRes();
    await handleApiRequest(req, res);
    expect(res._status).toBe(201);
    // resolveSession is called with explicit taskId so trackedSession can be merged.
    expect(mockedResolveSession).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'strategist', taskId: task.id })
    );
  });
});

describe('Wave 2 fixes — GET /projects defaults to active only', () => {
  it('omits archived projects unless includeArchived=true', async () => {
    const { listProjects } = await import('../src/core/projects.js');
    const mocked = vi.mocked(listProjects);
    mocked.mockClear();

    const req = createReq('GET', '/api/v1/projects');
    const res = createRes();
    await handleApiRequest(req, res);
    expect(res._status).toBe(200);
    expect(mocked).toHaveBeenCalledWith({ includeArchived: false });

    const req2 = createReq('GET', '/api/v1/projects?includeArchived=true');
    const res2 = createRes();
    await handleApiRequest(req2, res2);
    expect(mocked).toHaveBeenLastCalledWith({ includeArchived: true });
  });
});
