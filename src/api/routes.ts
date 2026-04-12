/**
 * REST API routes for the web dashboard.
 * Delegates /api/v1/* requests from the gateway.
 * Uses raw Node.js http module — no frameworks.
 */

import type { IncomingMessage, ServerResponse } from 'http';
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join, normalize, extname, basename } from 'path';
import { homedir } from 'os';
import { getRegisteredAgents, getAgent } from '../agents/registry.js';
import { listMemories, listSharedMemories } from '../agents/memory.js';
import {
  getTrackedSessions, getHealthStatus, hasCapacity,
  getSessionForIssue,
} from '../runtime/health.js';
import { sendToAgent, captureOutput, killAgent, sessionExists } from '../runtime/runner.js';
import { resolveSession } from '../runtime/resolve.js';
import { getQueue, cancelItem } from '../routing/queue.js';
import { getDb, getRecentEvents } from '../core/db.js';
import { createLogger } from '../core/logger.js';
import type { AgentRole } from '../linear/types.js';
import {
  getTask, listTasks, createTask, getTaskChildren, updateTask, deleteTask,
} from '../core/tasks.js';
import {
  createProject, getProject, listProjects, updateProject,
  archiveProject, getProjectStats,
} from '../core/projects.js';
import {
  createNotification, listNotifications, getUnreadCount,
  markRead, markAllRead, archiveNotification,
} from '../core/notifications.js';
import { bus } from '../bus.js';

const log = createLogger('api');

// --- Validation ---

/**
 * Allowed pattern for `issueKey` values that flow from user input into
 * tmux session names and filesystem paths. Restricting to alphanumerics,
 * dash, and underscore prevents shell metacharacter injection and path
 * traversal.
 */
const ISSUE_KEY_REGEX = /^[A-Za-z0-9_-]+$/;

/**
 * Broader identifier pattern for task/project rows. Task IDs are generated
 * with randomUUID (e.g. `task-4e9a...`) which contains hyphens and hex,
 * project IDs are slugged (`proj-marketing-q2`). Still rejects path
 * traversal and shell metacharacters.
 */
const ENTITY_ID_REGEX = /^[A-Za-z0-9_-]+$/;

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

    // === Tasks ===

    // -- Wave 2A new routes --
    if (method === 'GET' && path === '/tasks') {
      const projectId = url.searchParams.get('projectId') ?? undefined;
      const stateParam = url.searchParams.get('state') ?? undefined;
      const limitParam = url.searchParams.get('limit');
      const limit = limitParam ? Math.min(Math.max(parseInt(limitParam) || 50, 1), 500) : 50;
      const validStates = ['todo', 'running', 'review', 'done', 'failed', 'canceled'] as const;
      const state = stateParam && (validStates as readonly string[]).includes(stateParam)
        ? (stateParam as typeof validStates[number])
        : undefined;
      const tasks = listTasks({ projectId, state, limit });
      json(res, { tasks });
      return true;
    }

    // -- Wave 2A new routes --
    if (method === 'POST' && path === '/tasks') {
      const body = parseJson(await readBody(req));
      const title = body?.title;
      if (typeof title !== 'string' || !title.trim()) {
        error(res, 'title required (string)', 400);
        return true;
      }
      const description = typeof body?.description === 'string' ? body.description : undefined;
      const priorityRaw = body?.priority;
      const priority = typeof priorityRaw === 'number' && Number.isFinite(priorityRaw) ? priorityRaw : 3;
      const projectIdRaw = body?.projectId;
      let projectId: string | undefined;
      if (projectIdRaw !== undefined && projectIdRaw !== null) {
        if (typeof projectIdRaw !== 'string' || !ENTITY_ID_REGEX.test(projectIdRaw)) {
          error(res, 'Invalid projectId format', 400);
          return true;
        }
        if (!getProject(projectIdRaw)) {
          error(res, 'Unknown projectId', 404);
          return true;
        }
        projectId = projectIdRaw;
      }
      const rawRole = body?.agent;
      const role = (typeof rawRole === 'string' && rawRole) ? rawRole : 'engineer';
      const agent = getAgent(role);
      if (!agent) { error(res, 'Unknown agent role', 404); return true; }

      const task = createTask({
        title: title.trim(),
        description,
        priority,
        projectId: projectId ?? null,
        source: 'dashboard',
      });
      void bus.emit('task:created', {
        taskId: task.id,
        projectId: task.projectId,
        title: task.title,
        source: task.source,
      });

      const prompt = `${task.title}${task.description ? '\n\n' + task.description : ''}`;
      const result = resolveSession({
        role: agent.role as AgentRole,
        issueKey: task.id,
        prompt,
        priority: task.priority,
        taskId: task.id,
      });
      json(
        res,
        { task, action: result.action, tmuxSession: result.tmuxSession, error: result.error },
        result.action === 'blocked' ? 409 : 201,
      );
      return true;
    }

    // -- Wave 2A new routes --
    // GET /tasks/:id/comments, POST /tasks/:id/comments
    m = matchRoute('/tasks/:id/comments', path);
    if (m) {
      const id = m.params.id;
      if (!ENTITY_ID_REGEX.test(id)) { error(res, 'Invalid task id format', 400); return true; }
      if (method === 'GET') {
        const task = getTask(id);
        if (!task) { error(res, 'Task not found', 404); return true; }
        const rows = getDb().prepare(
          'SELECT * FROM task_comments WHERE task_id = ? ORDER BY created_at ASC'
        ).all(id) as Array<Record<string, unknown>>;
        json(res, { comments: rows.map(mapCommentRow) });
        return true;
      }
      if (method === 'POST') {
        const task = getTask(id);
        if (!task) { error(res, 'Task not found', 404); return true; }
        const body = parseJson(await readBody(req));
        const text = body?.body;
        if (typeof text !== 'string' || !text.trim()) {
          error(res, 'body required (string)', 400);
          return true;
        }
        const parentIdRaw = body?.parentId;
        const parentId = typeof parentIdRaw === 'number' && Number.isFinite(parentIdRaw)
          ? parentIdRaw : null;
        const result = getDb().prepare(
          'INSERT INTO task_comments (task_id, author, body, parent_id) VALUES (?, ?, ?, ?)'
        ).run(id, 'ceo', text, parentId);
        const commentId = Number(result.lastInsertRowid);
        const row = getDb().prepare(
          'SELECT * FROM task_comments WHERE id = ?'
        ).get(commentId) as Record<string, unknown>;
        const comment = mapCommentRow(row);

        // Pipe CEO message to any active session on this task
        const sessRows = getDb().prepare(
          "SELECT * FROM sessions WHERE task_id = ? AND state = 'active'"
        ).all(id) as Array<Record<string, unknown>>;
        for (const s of sessRows) {
          const tmux = s.tmux_session as string;
          if (tmux && sessionExists(tmux)) sendToAgent(tmux, text);
        }

        void bus.emit('task:commented', { taskId: id, author: 'ceo', body: text, commentId });
        json(res, { comment }, 201);
        return true;
      }
    }

    // -- Wave 2A new routes --
    // GET /tasks/:id/attachments and GET /tasks/:id/attachments/:filename
    m = matchRoute('/tasks/:id/attachments', path);
    if (method === 'GET' && m) {
      const id = m.params.id;
      if (!ENTITY_ID_REGEX.test(id)) { error(res, 'Invalid task id format', 400); return true; }
      const task = getTask(id);
      if (!task) { error(res, 'Task not found', 404); return true; }
      const wsDir = resolveTaskWorkspace(id);
      json(res, { attachments: wsDir ? listWorkspaceFiles(wsDir) : [] });
      return true;
    }

    m = matchRoute('/tasks/:id/attachments/:filename', path);
    if (method === 'GET' && m) {
      const id = m.params.id;
      const filename = decodeURIComponent(m.params.filename);
      if (!ENTITY_ID_REGEX.test(id)) { error(res, 'Invalid task id format', 400); return true; }
      const task = getTask(id);
      if (!task) { error(res, 'Task not found', 404); return true; }
      const wsDir = resolveTaskWorkspace(id);
      if (!wsDir) { error(res, 'No workspace for task', 404); return true; }
      // Jail: resolve inside workspace, reject traversal.
      const target = normalize(join(wsDir, filename));
      if (!target.startsWith(normalize(wsDir) + '/') && target !== normalize(wsDir)) {
        error(res, 'Invalid path', 400); return true;
      }
      if (!existsSync(target) || !statSync(target).isFile()) {
        error(res, 'File not found', 404); return true;
      }
      const ext = extname(filename).toLowerCase();
      const textExt = ['.md', '.ts', '.js', '.tsx', '.jsx', '.txt', '.log', '.yaml', '.yml', '.sh', '.py'];
      const imageExt = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'];
      if (ext === '.json') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(readFileSync(target));
        return true;
      }
      if (textExt.includes(ext)) {
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(readFileSync(target));
        return true;
      }
      if (imageExt.includes(ext)) {
        const mime = ext === '.svg' ? 'image/svg+xml'
          : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
          : `image/${ext.slice(1)}`;
        res.writeHead(200, { 'Content-Type': mime });
        res.end(readFileSync(target));
        return true;
      }
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      res.end(readFileSync(target));
      return true;
    }

    // -- Wave 2A new routes --
    // GET /tasks/:id/output?role=engineer
    m = matchRoute('/tasks/:id/output', path);
    if (method === 'GET' && m) {
      const id = m.params.id;
      if (!ENTITY_ID_REGEX.test(id)) { error(res, 'Invalid task id format', 400); return true; }
      const task = getTask(id);
      if (!task) { error(res, 'Task not found', 404); return true; }
      const roleParam = url.searchParams.get('role');
      const sessRows = getDb().prepare(
        "SELECT * FROM sessions WHERE task_id = ? AND state = 'active'"
      ).all(id) as Array<Record<string, unknown>>;
      const sess = roleParam
        ? sessRows.find(s => s.role === roleParam)
        : sessRows[0];
      if (!sess) { json(res, { lines: [] }); return true; }
      const linesParam = parseInt(url.searchParams.get('lines') ?? '100');
      const nLines = Number.isNaN(linesParam) ? 100 : Math.max(1, Math.min(linesParam, 1000));
      const output = captureOutput(sess.tmux_session as string, nLines);
      json(res, { lines: output.split('\n') });
      return true;
    }

    // -- Wave 2A new routes --
    // POST /tasks/:id/dispatch — spawn another role on the SAME task.
    m = matchRoute('/tasks/:id/dispatch', path);
    if (method === 'POST' && m) {
      const id = m.params.id;
      if (!ENTITY_ID_REGEX.test(id)) { error(res, 'Invalid task id format', 400); return true; }
      const task = getTask(id);
      if (!task) { error(res, 'Task not found', 404); return true; }
      const body = parseJson(await readBody(req));
      const roleRaw = body?.role;
      if (typeof roleRaw !== 'string' || !roleRaw) {
        error(res, 'role required (string)', 400); return true;
      }
      const agent = getAgent(roleRaw);
      if (!agent) { error(res, 'Unknown agent role', 404); return true; }
      const context = typeof body?.context === 'string' ? body.context : undefined;
      const prompt = context ?? `${task.title}${task.description ? '\n\n' + task.description : ''}`;
      // Multi-contributor: use a per-role issueKey alias that still maps to the task.
      const issueKey = `${task.id}-${agent.role}`;
      const result = resolveSession({
        role: agent.role as AgentRole,
        issueKey,
        prompt,
        priority: task.priority,
        taskId: task.id,
      });
      // Only fire dispatch notification when the spawn actually succeeded.
      // resolveSession returns 'spawned' | 'piped' | 'resumed' | 'queued' | 'blocked' —
      // 'blocked' (budget, circuit breaker, capacity-with-no-evict) must NOT notify.
      if (result.action !== 'blocked') {
        void bus.emit('task:dispatched', {
          taskId: task.id,
          role: agent.role,
          parentTaskId: task.parentTaskId,
        });
      }
      json(
        res,
        { session: { issueKey, role: agent.role, ...result }, task },
        result.action === 'blocked' ? 409 : 201,
      );
      return true;
    }

    // -- Wave 2A new routes --
    // GET /tasks/:id — full detail shape
    m = matchRoute('/tasks/:id', path);
    if (m) {
      const id = m.params.id;
      if (!ENTITY_ID_REGEX.test(id)) {
        error(res, 'Invalid task id format', 400);
        return true;
      }
      if (method === 'GET') {
        // Prefer first-class task lookup; fall back to legacy session lookup so
        // the dashboard can still inspect issueKey-scoped sessions.
        const task = getTask(id);
        if (task) {
          const detail = buildTaskDetail(task);
          json(res, detail);
          return true;
        }
        const session = getSessionForIssue(id);
        if (!session) { error(res, 'Task not found', 404); return true; }
        const alive = session.state === 'active' && sessionExists(session.tmuxSession);
        json(res, { ...session, alive });
        return true;
      }
      if (method === 'PATCH') {
        const task = getTask(id);
        if (!task) { error(res, 'Task not found', 404); return true; }
        const body = parseJson(await readBody(req));
        if (!body) { error(res, 'Invalid JSON body', 400); return true; }
        const patch: Record<string, unknown> = {};
        for (const key of ['title', 'description', 'priority', 'projectId', 'state'] as const) {
          if (key in body) patch[key] = body[key];
        }
        if (patch.projectId !== undefined && patch.projectId !== null) {
          if (typeof patch.projectId !== 'string' || !ENTITY_ID_REGEX.test(patch.projectId)) {
            error(res, 'Invalid projectId format', 400); return true;
          }
          if (!getProject(patch.projectId as string)) {
            error(res, 'Unknown projectId', 404); return true;
          }
        }
        const updated = updateTask(id, patch as Parameters<typeof updateTask>[1]);
        json(res, { task: updated });
        return true;
      }
      if (method === 'DELETE') {
        // Kill any active sessions tied to the task row OR a matching issueKey,
        // then hard-delete the task row + dependent task_events / task_comments.
        const task = getTask(id);
        if (task) {
          const sessRows = getDb().prepare(
            "SELECT * FROM sessions WHERE task_id = ? AND state = 'active'"
          ).all(id) as Array<Record<string, unknown>>;
          let killed = 0;
          for (const s of sessRows) {
            const tmux = s.tmux_session as string;
            if (tmux && sessionExists(tmux)) {
              killAgent(tmux);
              killed++;
            }
          }
          // Hard delete the task row + cascading children.
          let removed = false;
          try { removed = deleteTask(id); } catch (err) {
            log.error(`deleteTask(${id}) failed: ${(err as Error).message}`);
          }
          json(res, { ok: true, killed: task.id, sessions: killed, deleted: removed });
          return true;
        }
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

    // === Projects ===
    // -- Wave 2A new routes --
    if (method === 'GET' && path === '/projects') {
      const includeArchived = url.searchParams.get('includeArchived') === 'true';
      const projects = listProjects({ includeArchived }).map(p => ({ ...p, stats: getProjectStats(p.id) }));
      json(res, { projects });
      return true;
    }

    if (method === 'POST' && path === '/projects') {
      const body = parseJson(await readBody(req));
      const name = body?.name;
      if (typeof name !== 'string' || !name.trim()) {
        error(res, 'name required (string)', 400); return true;
      }
      const project = createProject({
        name: name.trim(),
        description: typeof body?.description === 'string' ? body.description : undefined,
        color: typeof body?.color === 'string' ? body.color : undefined,
        icon: typeof body?.icon === 'string' ? body.icon : undefined,
      });
      json(res, { project }, 201);
      return true;
    }

    m = matchRoute('/projects/:id', path);
    if (m) {
      const id = m.params.id;
      if (!ENTITY_ID_REGEX.test(id)) { error(res, 'Invalid project id format', 400); return true; }
      if (method === 'GET') {
        const project = getProject(id);
        if (!project) { error(res, 'Project not found', 404); return true; }
        const recentTasks = listTasks({ projectId: id, limit: 20 });
        const stats = getProjectStats(id);
        json(res, { project, recentTasks, stats });
        return true;
      }
      if (method === 'PATCH') {
        const project = getProject(id);
        if (!project) { error(res, 'Project not found', 404); return true; }
        const body = parseJson(await readBody(req));
        if (!body) { error(res, 'Invalid JSON body', 400); return true; }
        const patch: Record<string, unknown> = {};
        for (const key of ['name', 'description', 'color', 'icon', 'state'] as const) {
          if (key in body) patch[key] = body[key];
        }
        const updated = updateProject(id, patch as Parameters<typeof updateProject>[1]);
        json(res, { project: updated });
        return true;
      }
      if (method === 'DELETE') {
        const project = getProject(id);
        if (!project) { error(res, 'Project not found', 404); return true; }
        archiveProject(id);
        json(res, { ok: true });
        return true;
      }
    }

    // === Notifications ===
    // -- Wave 2A new routes --
    if (method === 'GET' && path === '/notifications') {
      const filterParam = url.searchParams.get('filter') ?? 'all';
      const limitParam = url.searchParams.get('limit');
      const limit = limitParam ? Math.min(Math.max(parseInt(limitParam) || 50, 1), 500) : 50;
      let notifications;
      if (filterParam === 'unread') {
        notifications = listNotifications({ read: false, archived: false, limit });
      } else if (filterParam === 'archive') {
        notifications = listNotifications({ archived: true, limit });
      } else {
        notifications = listNotifications({ archived: false, limit });
      }
      json(res, { notifications, unreadCount: getUnreadCount() });
      return true;
    }

    if (method === 'GET' && path === '/notifications/unread-count') {
      json(res, { count: getUnreadCount() });
      return true;
    }

    if (method === 'POST' && path === '/notifications/mark-all-read') {
      const count = markAllRead();
      json(res, { ok: true, count });
      return true;
    }

    m = matchRoute('/notifications/:id/read', path);
    if (method === 'POST' && m) {
      const id = parseInt(m.params.id);
      if (!Number.isFinite(id) || id <= 0) { error(res, 'Invalid notification id', 400); return true; }
      markRead(id);
      json(res, { ok: true });
      return true;
    }

    m = matchRoute('/notifications/:id/archive', path);
    if (method === 'POST' && m) {
      const id = parseInt(m.params.id);
      if (!Number.isFinite(id) || id <= 0) { error(res, 'Invalid notification id', 400); return true; }
      archiveNotification(id);
      json(res, { ok: true });
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

    // Mark unused to silence TS when only a subset of helpers is used.
    void createNotification;

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

// -- Wave 2A helper functions --

function mapCommentRow(r: Record<string, unknown>): {
  id: number; taskId: string; author: string; body: string;
  parentId: number | null; createdAt: number;
} {
  return {
    id: r.id as number,
    taskId: r.task_id as string,
    author: r.author as string,
    body: r.body as string,
    parentId: (r.parent_id as number | null) ?? null,
    createdAt: r.created_at as number,
  };
}

/** Find a workspace directory for a task by consulting its sessions table. */
function resolveTaskWorkspace(taskId: string): string | null {
  try {
    const row = getDb().prepare(
      'SELECT issue_key FROM sessions WHERE task_id = ? ORDER BY spawned_at ASC LIMIT 1'
    ).get(taskId) as { issue_key: string } | undefined;
    const issueKey = row?.issue_key;
    if (!issueKey) return null;
    const base = process.env.ANC_WORKSPACE_BASE || join(homedir(), 'anc-workspaces');
    const dir = join(base, issueKey);
    return existsSync(dir) ? dir : null;
  } catch {
    return null;
  }
}

const WORKSPACE_SKIP = new Set(['.git', 'node_modules', '.anc', '.claude', '.agent-memory']);

interface AttachmentEntry {
  name: string;
  size: number;
  mtime: number;
  kind: 'text' | 'json' | 'image' | 'binary' | 'dir';
}

function classify(ext: string): AttachmentEntry['kind'] {
  const e = ext.toLowerCase();
  if (e === '.json') return 'json';
  if (['.md', '.ts', '.js', '.tsx', '.jsx', '.txt', '.log', '.yaml', '.yml', '.sh', '.py'].includes(e)) return 'text';
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'].includes(e)) return 'image';
  return 'binary';
}

function listWorkspaceFiles(dir: string): AttachmentEntry[] {
  const out: AttachmentEntry[] = [];
  try {
    for (const name of readdirSync(dir)) {
      if (WORKSPACE_SKIP.has(name)) continue;
      const full = join(dir, name);
      let s;
      try { s = statSync(full); } catch { continue; }
      if (s.isDirectory()) {
        out.push({ name, size: 0, mtime: s.mtimeMs, kind: 'dir' });
      } else {
        out.push({ name, size: s.size, mtime: s.mtimeMs, kind: classify(extname(name)) });
      }
    }
  } catch { /* ignore */ }
  out.sort((a, b) => b.mtime - a.mtime);
  return out;
}

interface TaskDetail {
  task: ReturnType<typeof getTask>;
  sessions: Array<{
    issueKey: string; role: string; state: string;
    tmuxSession?: string; spawnedAt: number; alive: boolean;
  }>;
  events: Array<Record<string, unknown>>;
  comments: Array<ReturnType<typeof mapCommentRow>>;
  attachments: AttachmentEntry[];
  cost: { totalUsd: number; byAgent: Array<{ role: string; usd: number; tokens: number }> };
  children: ReturnType<typeof getTaskChildren>;
  handoff: { body: string; actions?: unknown } | null;
}

function buildTaskDetail(task: NonNullable<ReturnType<typeof getTask>>): TaskDetail {
  const db = getDb();

  const sessionRows = db.prepare(
    'SELECT * FROM sessions WHERE task_id = ? ORDER BY spawned_at ASC'
  ).all(task.id) as Array<Record<string, unknown>>;
  const sessions = sessionRows.map(r => {
    const tmux = r.tmux_session as string;
    return {
      issueKey: r.issue_key as string,
      role: r.role as string,
      state: r.state as string,
      tmuxSession: tmux,
      spawnedAt: r.spawned_at as number,
      alive: r.state === 'active' && sessionExists(tmux),
    };
  });

  // Merge in-memory tracked sessions that haven't been flushed to DB yet.
  // Match on either taskId (preferred) or issueKey == task.id (legacy single-session shape).
  const seen = new Set(sessions.map(s => `${s.role}:${s.issueKey}`));
  for (const t of getTrackedSessions()) {
    if (t.taskId !== task.id && t.issueKey !== task.id && !t.issueKey.startsWith(`${task.id}-`)) continue;
    const key = `${t.role}:${t.issueKey}`;
    if (seen.has(key)) continue;
    seen.add(key);
    sessions.push({
      issueKey: t.issueKey,
      role: t.role,
      state: t.state,
      tmuxSession: t.tmuxSession,
      spawnedAt: t.spawnedAt,
      alive: t.state === 'active' && sessionExists(t.tmuxSession),
    });
  }

  const eventRows = db.prepare(
    'SELECT * FROM task_events WHERE task_id = ? ORDER BY created_at DESC LIMIT 100'
  ).all(task.id) as Array<Record<string, unknown>>;
  const events = eventRows.map(r => ({
    id: r.id,
    taskId: r.task_id,
    role: r.role,
    type: r.type,
    payload: r.payload,
    createdAt: r.created_at,
  }));

  const commentRows = db.prepare(
    'SELECT * FROM task_comments WHERE task_id = ? ORDER BY created_at ASC'
  ).all(task.id) as Array<Record<string, unknown>>;
  const comments = commentRows.map(mapCommentRow);

  // Attachments from the first session's workspace (if any)
  const firstSessionKey = sessionRows[0]?.issue_key as string | undefined;
  let attachments: AttachmentEntry[] = [];
  let handoff: { body: string; actions?: unknown } | null = null;
  if (firstSessionKey) {
    const base = process.env.ANC_WORKSPACE_BASE || join(homedir(), 'anc-workspaces');
    const wsDir = join(base, firstSessionKey);
    if (existsSync(wsDir)) {
      attachments = listWorkspaceFiles(wsDir);
      const handoffPath = join(wsDir, 'HANDOFF.md');
      if (existsSync(handoffPath)) {
        try {
          handoff = { body: readFileSync(handoffPath, 'utf-8') };
        } catch { /* ignore */ }
      }
    }
  }

  // Cost aggregation
  const sessionKeys = sessionRows.map(r => r.issue_key as string);
  let cost = { totalUsd: 0, byAgent: [] as Array<{ role: string; usd: number; tokens: number }> };
  if (sessionKeys.length > 0) {
    const placeholders = sessionKeys.map(() => '?').join(',');
    const rows = db.prepare(
      `SELECT agent_role, SUM(cost_usd) AS usd, SUM(tokens) AS tokens
       FROM budget_log WHERE issue_key IN (${placeholders}) GROUP BY agent_role`
    ).all(...sessionKeys) as Array<{ agent_role: string; usd: number; tokens: number }>;
    const byAgent = rows.map(r => ({
      role: r.agent_role,
      usd: Number(r.usd ?? 0),
      tokens: Number(r.tokens ?? 0),
    }));
    const totalUsd = byAgent.reduce((s, r) => s + r.usd, 0);
    cost = { totalUsd, byAgent };
  }

  const children = getTaskChildren(task.id);

  // Note: filename of the workspace file (basename) used here for clarity.
  void basename;

  return { task, sessions, events, comments, attachments, cost, children, handoff };
}
