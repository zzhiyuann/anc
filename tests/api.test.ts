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
    { id: 'q-1', issueKey: 'ANC-10', agentRole: 'engineer', priority: 3, status: 'queued', createdAt: new Date().toISOString() },
  ]),
  cancelItem: vi.fn(),
}));

vi.mock('../src/core/db.js', () => ({
  getRecentEvents: vi.fn(() => []),
  getDb: vi.fn(),
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
  it('returns task list', async () => {
    const req = createReq('GET', '/api/v1/tasks');
    const res = createRes();
    await handleApiRequest(req, res);

    expect(res._status).toBe(200);
    const data = res._parsed() as { tasks: Array<{ id: string; role: string; state: string }> };
    expect(data.tasks).toHaveLength(2);
    expect(data.tasks[0].role).toBe('engineer');
  });
});

// --- POST /tasks ---

describe('API — POST /tasks', () => {
  it('creates a new task', async () => {
    const req = createReq('POST', '/api/v1/tasks', { title: 'Fix the bug', agent: 'engineer' });
    const res = createRes();
    await handleApiRequest(req, res);

    expect(res._status).toBe(201);
    expect(mockedResolveSession).toHaveBeenCalled();
    const data = res._parsed() as { issueKey: string };
    expect(data.issueKey).toMatch(/^manual-/);
  });

  it('returns 400 when title is missing', async () => {
    const req = createReq('POST', '/api/v1/tasks', {});
    const res = createRes();
    await handleApiRequest(req, res);

    expect(res._status).toBe(400);
    const data = res._parsed() as { error: string };
    expect(data.error).toContain('title');
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
    const data = res._parsed() as { items: Array<{ id: string }> };
    expect(data.items).toHaveLength(1);
    expect(data.items[0].id).toBe('q-1');
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
