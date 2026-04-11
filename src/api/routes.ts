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
import type { AgentRole } from '../linear/types.js';

// --- Helpers ---

function json(res: ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function error(res: ServerResponse, msg: string, status = 400): void {
  json(res, { error: msg }, status);
}

async function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
    req.on('end', () => resolve(body));
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
  const url = new URL(req.url!, 'http://localhost');
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
    const issueKey = body?.issueKey as string;
    if (!issueKey) { error(res, 'issueKey required'); return true; }
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
    const message = body?.message as string;
    if (!message) { error(res, 'message required'); return true; }
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
    const lines = parseInt(url.searchParams.get('lines') || '50');
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
    if (!body?.title) { error(res, 'title required'); return true; }
    const role = (body.agent as string) || 'engineer';
    const agent = getAgent(role);
    if (!agent) { error(res, 'Unknown agent role', 404); return true; }
    const issueKey = `manual-${Date.now()}`;
    const prompt = `${body.title}${body.description ? '\n\n' + body.description : ''}`;
    const result = resolveSession({
      role: agent.role as AgentRole,
      issueKey,
      prompt,
      priority: (body.priority as number) ?? 3,
    });
    json(res, { issueKey, ...result }, result.action === 'blocked' ? 409 : 201);
    return true;
  }

  m = matchRoute('/tasks/:id', path);
  if (method === 'GET' && m) {
    const session = getSessionForIssue(m.params.id);
    if (!session) { error(res, 'Task not found', 404); return true; }
    const alive = session.state === 'active' && sessionExists(session.tmuxSession);
    json(res, { ...session, alive });
    return true;
  }

  m = matchRoute('/tasks/:id', path);
  if (method === 'DELETE' && m) {
    const session = getSessionForIssue(m.params.id);
    if (!session) { error(res, 'Task not found', 404); return true; }
    if (session.state === 'active' && sessionExists(session.tmuxSession)) {
      killAgent(session.tmuxSession);
    }
    json(res, { ok: true, killed: m.params.id });
    return true;
  }

  m = matchRoute('/tasks/:id/resume', path);
  if (method === 'POST' && m) {
    const session = getSessionForIssue(m.params.id);
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
    const status = url.searchParams.get('status') as 'queued' | 'processing' | undefined;
    json(res, { items: getQueue(status || undefined) });
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
}
