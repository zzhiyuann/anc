/**
 * REST API routes for the web dashboard.
 * Delegates /api/v1/* requests from the gateway.
 * Uses raw Node.js http module — no frameworks.
 */

import type { IncomingMessage, ServerResponse } from 'http';
import { getRegisteredAgents, getAgent } from '../agents/registry.js';
import { listMemories, listSharedMemories } from '../agents/memory.js';
import {
  getTrackedSessions, getHealthStatus, hasCapacity,
  getSessionForIssue,
} from '../runtime/health.js';
import { sendToAgent, captureOutput, killAgent, sessionExists } from '../runtime/runner.js';
import { resolveSession } from '../runtime/resolve.js';
import { getQueue, cancelItem } from '../routing/queue.js';
import { getRecentEvents } from '../core/db.js';
import { createLogger } from '../core/logger.js';
import type { AgentRole } from '../linear/types.js';

const log = createLogger('api');

// --- Validation ---

/**
 * Allowed pattern for `issueKey` values that flow from user input into
 * tmux session names and filesystem paths. Restricting to alphanumerics,
 * dash, and underscore prevents shell metacharacter injection and path
 * traversal.
 */
const ISSUE_KEY_REGEX = /^[A-Za-z0-9_-]+$/;

// --- Auth ---

/** True if the connection came from the loopback interface. */
export function isLocalhost(req: IncomingMessage): boolean {
  const addr = req.socket?.remoteAddress;
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

/**
 * Authorization check: localhost requests are always allowed; remote requests
 * require a Bearer token matching the `ANC_API_TOKEN` environment variable.
 * If the env var is not set, remote access is denied outright.
 */
export function checkAuth(req: IncomingMessage): boolean {
  if (isLocalhost(req)) return true;
  const header = req.headers.authorization;
  const token = typeof header === 'string' ? header.replace(/^Bearer /, '') : '';
  const expected = process.env.ANC_API_TOKEN;
  if (!expected) return false; // no token configured = no remote access
  return token === expected;
}

// --- Helpers ---

function json(res: ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function error(res: ServerResponse, msg: string, status = 400): void {
  json(res, { error: msg }, status);
}

async function readBody(req: IncomingMessage, maxBytes = 1_048_576): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        req.destroy();
        reject(new Error('Request body too large'));
        return;
      }
      body += chunk.toString();
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function parseJson(body: string): Record<string, unknown> | null {
  try { return JSON.parse(body); } catch { return null; }
}

// --- Route matcher ---

interface RouteMatch {
  params: Record<string, string>;
}

function matchRoute(pattern: string, path: string): RouteMatch | null {
  const patternParts = pattern.split('/');
  const pathParts = path.split('/');
  if (patternParts.length !== pathParts.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < patternParts.length; i++) {
    if (patternParts[i].startsWith(':')) {
      params[patternParts[i].slice(1)] = pathParts[i];
    } else if (patternParts[i] !== pathParts[i]) {
      return null;
    }
  }
  return { params };
}

// --- Main handler ---

export async function handleApiRequest(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  try {
    if (!checkAuth(req)) {
      error(res, 'Unauthorized', 401);
      return true;
    }

    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname.replace(/^\/api\/v1/, '');
    const method = req.method ?? 'GET';

    // === Agents ===

    if (method === 'GET' && path === '/agents') {
      const agents = getRegisteredAgents().map(a => {
        const health = getHealthStatus(a.role);
        return {
          role: a.role,
          name: a.name,
          hasCapacity: hasCapacity(a.role),
          ...health,
        };
      });
      json(res, { agents });
      return true;
    }

    let m = matchRoute('/agents/:role', path);
    if (method === 'GET' && m) {
      const agent = getAgent(m.params.role);
      if (!agent) { error(res, 'Unknown agent role', 404); return true; }
      const health = getHealthStatus(agent.role);
      const memories = listMemories(agent.role);
      json(res, { ...agent, ...health, memoryCount: memories.length });
      return true;
    }

    m = matchRoute('/agents/:role/start', path);
    if (method === 'POST' && m) {
      const body = parseJson(await readBody(req));
      const issueKey = body?.issueKey;
      if (typeof issueKey !== 'string' || !ISSUE_KEY_REGEX.test(issueKey)) {
        error(res, 'Invalid issueKey format (alphanumeric, dash, underscore only)', 400);
        return true;
      }
      const agent = getAgent(m.params.role);
      if (!agent) { error(res, 'Unknown agent role', 404); return true; }
      const result = resolveSession({ role: agent.role as AgentRole, issueKey });
      json(res, result, result.action === 'blocked' ? 409 : 200);
      return true;
    }

    m = matchRoute('/agents/:role/stop', path);
    if (method === 'POST' && m) {
      const agent = getAgent(m.params.role);
      if (!agent) { error(res, 'Unknown agent role', 404); return true; }
      const sessions = getTrackedSessions().filter(
        s => s.role === agent.role && s.state === 'active'
      );
      let stopped = 0;
      for (const s of sessions) {
        if (sessionExists(s.tmuxSession)) {
          sendToAgent(s.tmuxSession, '/exit');
          stopped++;
        }
      }
      json(res, { ok: true, stopped });
      return true;
    }

    m = matchRoute('/agents/:role/talk', path);
    if (method === 'POST' && m) {
      const body = parseJson(await readBody(req));
      const message = body?.message;
      if (typeof message !== 'string' || !message) {
        error(res, 'message required (string)', 400);
        return true;
      }
      const agent = getAgent(m.params.role);
      if (!agent) { error(res, 'Unknown agent role', 404); return true; }
      const sessions = getTrackedSessions().filter(
        s => s.role === agent.role && s.state === 'active'
      );
      if (sessions.length === 0) { error(res, 'No active sessions', 404); return true; }
      const sent = sessions.filter(s => sendToAgent(s.tmuxSession, message)).length;
      json(res, { ok: true, sent, total: sessions.length });
      return true;
    }

    m = matchRoute('/agents/:role/output', path);
    if (method === 'GET' && m) {
      const agent = getAgent(m.params.role);
      if (!agent) { error(res, 'Unknown agent role', 404); return true; }
      const linesParam = parseInt(url.searchParams.get('lines') ?? '50');
      const lines = Number.isNaN(linesParam) ? 50 : Math.max(1, Math.min(linesParam, 1000));
      const sessions = getTrackedSessions().filter(
        s => s.role === agent.role && s.state === 'active'
      );
      const outputs = sessions.map(s => ({
        issueKey: s.issueKey,
        tmuxSession: s.tmuxSession,
        output: captureOutput(s.tmuxSession, lines),
      }));
      json(res, { outputs });
      return true;
    }

    m = matchRoute('/agents/:role/memory', path);
    if (method === 'GET' && m) {
      const agent = getAgent(m.params.role);
      if (!agent) { error(res, 'Unknown agent role', 404); return true; }
      json(res, { role: agent.role, files: listMemories(agent.role) });
      return true;
    }

    // === Tasks (mapped to tracked sessions + queue) ===

    if (method === 'GET' && path === '/tasks') {
      const statusFilter = url.searchParams.get('status');
      const agentFilter = url.searchParams.get('agent');
      let sessions = getTrackedSessions();
      if (statusFilter) sessions = sessions.filter(s => s.state === statusFilter);
      if (agentFilter) sessions = sessions.filter(s => s.role === agentFilter);
      const tasks = sessions.map(s => ({
        id: s.issueKey,
        role: s.role,
        issueKey: s.issueKey,
        state: s.state,
        priority: s.priority,
        spawnedAt: s.spawnedAt,
        isDuty: s.isDuty,
        ceoAssigned: s.ceoAssigned,
      }));
      json(res, { tasks });
      return true;
    }

    if (method === 'POST' && path === '/tasks') {
      const body = parseJson(await readBody(req));
      const title = body?.title;
      if (typeof title !== 'string' || !title) {
        error(res, 'title required (string)', 400);
        return true;
      }
      const rawRole = body?.agent;
      const role = (typeof rawRole === 'string' && rawRole) ? rawRole : 'engineer';
      const agent = getAgent(role);
      if (!agent) { error(res, 'Unknown agent role', 404); return true; }
      const issueKey = `manual-${Date.now()}`;
      const description = typeof body?.description === 'string' ? body.description : '';
      const prompt = `${title}${description ? '\n\n' + description : ''}`;
      const priorityRaw = body?.priority;
      const priority = typeof priorityRaw === 'number' && Number.isFinite(priorityRaw) ? priorityRaw : 3;
      const result = resolveSession({
        role: agent.role as AgentRole,
        issueKey,
        prompt,
        priority,
      });
      json(res, { issueKey, ...result }, result.action === 'blocked' ? 409 : 201);
      return true;
    }

    m = matchRoute('/tasks/:id', path);
    if (m) {
      const id = m.params.id;
      if (!ISSUE_KEY_REGEX.test(id)) {
        error(res, 'Invalid task id format (alphanumeric, dash, underscore only)', 400);
        return true;
      }
      if (method === 'GET') {
        const session = getSessionForIssue(id);
        if (!session) { error(res, 'Task not found', 404); return true; }
        const alive = session.state === 'active' && sessionExists(session.tmuxSession);
        json(res, { ...session, alive });
        return true;
      }
      if (method === 'DELETE') {
        const session = getSessionForIssue(id);
        if (!session) { error(res, 'Task not found', 404); return true; }
        if (session.state === 'active' && sessionExists(session.tmuxSession)) {
          killAgent(session.tmuxSession);
        }
        json(res, { ok: true, killed: id });
        return true;
      }
    }

    m = matchRoute('/tasks/:id/resume', path);
    if (method === 'POST' && m) {
      const id = m.params.id;
      if (!ISSUE_KEY_REGEX.test(id)) {
        error(res, 'Invalid task id format (alphanumeric, dash, underscore only)', 400);
        return true;
      }
      const session = getSessionForIssue(id);
      if (!session) { error(res, 'Task not found', 404); return true; }
      if (session.state === 'active') { error(res, 'Task already active', 409); return true; }
      const result = resolveSession({
        role: session.role as AgentRole,
        issueKey: session.issueKey,
      });
      json(res, result);
      return true;
    }

    // === System ===

    if (method === 'GET' && path === '/queue') {
      const statusParam = url.searchParams.get('status');
      const validStatuses = ['queued', 'processing'] as const;
      const status = statusParam && (validStatuses as readonly string[]).includes(statusParam)
        ? (statusParam as 'queued' | 'processing')
        : undefined;
      json(res, { queue: getQueue(status) });
      return true;
    }

    // DELETE /api/v1/queue/:id
    m = matchRoute('/queue/:id', path);
    if (method === 'DELETE' && m) {
      cancelItem(m.params.id);
      json(res, { ok: true });
      return true;
    }

    // GET /api/v1/events?limit=50
    if (path === '/events' && method === 'GET') {
      const limitParam = parseInt(url.searchParams.get('limit') ?? '50');
      const limit = Number.isNaN(limitParam) ? 50 : Math.min(Math.max(limitParam, 1), 500);
      const events = getRecentEvents(limit);
      json(res, { events });
      return true;
    }

    if (method === 'GET' && path === '/memory/shared') {
      json(res, { files: listSharedMemories() });
      return true;
    }

    m = matchRoute('/memory/:role', path);
    if (method === 'GET' && m) {
      const agent = getAgent(m.params.role);
      if (!agent) { error(res, 'Unknown agent role', 404); return true; }
      json(res, { role: agent.role, files: listMemories(agent.role) });
      return true;
    }

    // No match
    return false;
  } catch (err) {
    log.error(`API error: ${(err as Error).message}`);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error', message: (err as Error).message }));
    }
    return true;
  }
}
