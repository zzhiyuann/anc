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
  transitionTaskState, getChildCounts, type TaskState,
} from '../core/tasks.js';
import {
  listLabels, createLabel, deleteLabel, setTaskLabels, getTaskLabels,
  getLabelsForTasks,
} from '../core/labels.js';
import {
  loadReviewConfig, saveReviewConfig, resetReviewConfig, resolveReviewLevel,
  type ReviewLevel, type ReviewConfigPatch,
} from '../core/review.js';
import {
  createProject, getProject, listProjects, updateProject,
  archiveProject, getProjectStats,
} from '../core/projects.js';
import {
  createNotification, listNotifications, getUnreadCount,
  markRead, markAllRead, archiveNotification,
} from '../core/notifications.js';
import { bus } from '../bus.js';
import {
  getConfig as getBudgetConfig,
  saveConfig as saveBudgetConfig,
  resetTodayBudget,
  isDisabled as isBudgetDisabled,
  getSummary as getBudgetSummary,
  type BudgetConfig,
  type BudgetConfigPatch,
} from '../core/budget.js';

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

/**
 * Validate a PATCH /config/budget body and coerce to a BudgetConfigPatch.
 * Returns { value } on success, { error } on invalid input. Numeric fields
 * must be finite; alertAt must be in [0, 1]; limit must be >= 0. Per-agent
 * roles are restricted to the same identifier shape used elsewhere.
 */
function validateBudgetPatch(
  body: Record<string, unknown>,
): { value: BudgetConfigPatch } | { error: string } {
  const out: BudgetConfigPatch = {};

  if (body.daily !== undefined) {
    if (typeof body.daily !== 'object' || body.daily === null) {
      return { error: 'daily must be an object' };
    }
    const d = body.daily as Record<string, unknown>;
    const daily: Partial<BudgetConfig['daily']> = {};
    if (d.limit !== undefined) {
      if (typeof d.limit !== 'number' || !Number.isFinite(d.limit) || d.limit < 0) {
        return { error: 'daily.limit must be a non-negative number' };
      }
      daily.limit = d.limit;
    }
    if (d.alertAt !== undefined) {
      if (typeof d.alertAt !== 'number' || !Number.isFinite(d.alertAt) || d.alertAt < 0 || d.alertAt > 1) {
        return { error: 'daily.alertAt must be a number in [0, 1]' };
      }
      daily.alertAt = d.alertAt;
    }
    out.daily = daily;
  }

  if (body.agents !== undefined) {
    if (typeof body.agents !== 'object' || body.agents === null) {
      return { error: 'agents must be an object' };
    }
    const agents: Record<string, { limit: number; alertAt: number } | null> = {};
    for (const [role, value] of Object.entries(body.agents as Record<string, unknown>)) {
      if (!ENTITY_ID_REGEX.test(role)) {
        return { error: `Invalid agent role: ${role}` };
      }
      if (value === null) {
        agents[role] = null;
        continue;
      }
      if (typeof value !== 'object') {
        return { error: `agents.${role} must be an object or null` };
      }
      const v = value as Record<string, unknown>;
      let limit = 0;
      let alertAt = 0.8;
      if (v.limit !== undefined) {
        if (typeof v.limit !== 'number' || !Number.isFinite(v.limit) || v.limit < 0) {
          return { error: `agents.${role}.limit must be a non-negative number` };
        }
        limit = v.limit;
      }
      if (v.alertAt !== undefined) {
        if (typeof v.alertAt !== 'number' || !Number.isFinite(v.alertAt) || v.alertAt < 0 || v.alertAt > 1) {
          return { error: `agents.${role}.alertAt must be a number in [0, 1]` };
        }
        alertAt = v.alertAt;
      }
      agents[role] = { limit, alertAt };
    }
    out.agents = agents;
  }

  return { value: out };
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
      const assignee = url.searchParams.get('assignee') ?? undefined;
      const limit = limitParam ? Math.min(Math.max(parseInt(limitParam) || 50, 1), 500) : 50;
      const validStates = ['todo', 'running', 'review', 'done', 'failed', 'canceled'] as const;
      const state = stateParam && (validStates as readonly string[]).includes(stateParam)
        ? (stateParam as typeof validStates[number])
        : undefined;
      const tasks = listTasks({ projectId, state, limit, assignee });
      const labelsByTask = getLabelsForTasks(tasks.map(t => t.id));
      const tasksWithMeta = tasks.map(t => ({ ...t, labels: labelsByTask[t.id] ?? [] }));
      json(res, { tasks: tasksWithMeta });
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

      const assigneeRaw = body?.assignee;
      const assignee = typeof assigneeRaw === 'string' && assigneeRaw.trim() ? assigneeRaw.trim() : undefined;
      const task = createTask({
        title: title.trim(),
        description,
        priority,
        projectId: projectId ?? null,
        source: 'dashboard',
        ...(assignee ? { assignee } : {}),
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
        // Accept author from body — agents post as "agent:<role>", dashboard defaults to "ceo"
        const authorRaw = body?.author;
        const author = typeof authorRaw === 'string' && authorRaw.trim() ? authorRaw.trim() : 'ceo';
        const result = getDb().prepare(
          'INSERT INTO task_comments (task_id, author, body, parent_id) VALUES (?, ?, ?, ?)'
        ).run(id, author, text, parentId);
        const commentId = Number(result.lastInsertRowid);
        const row = getDb().prepare(
          'SELECT * FROM task_comments WHERE id = ?'
        ).get(commentId) as Record<string, unknown>;
        const comment = mapCommentRow(row);

        // Pipe CEO message to any session with a live tmux pane on this task.
        // In interactive mode, sessions may be 'idle' (Stop hook fired) but the
        // tmux pane is still alive with claude waiting for input. Include both
        // active and idle sessions, checking tmux liveness.
        if (!author.startsWith('agent:')) {
          const sessRows = getDb().prepare(
            "SELECT * FROM sessions WHERE task_id = ? AND state IN ('active', 'idle')"
          ).all(id) as Array<Record<string, unknown>>;
          for (const s of sessRows) {
            const tmux = s.tmux_session as string;
            if (tmux && sessionExists(tmux)) sendToAgent(tmux, text);
          }
        }

        void bus.emit('task:commented', { taskId: id, author, body: text, commentId });

        // Mention fanout: spawn a session for every non-CEO role mentioned.
        // Accept mentions from BOTH (a) explicit `mentions` array (string[] OR
        // {role}[] — frontend currently sends string[]) and (b) raw `@role`
        // tokens scanned from the comment body. Union + dedupe.
        const warnings: string[] = [];
        const mentionRoles = new Set<string>();
        const mentionsRaw = (body as Record<string, unknown>).mentions;
        if (Array.isArray(mentionsRaw)) {
          for (const mention of mentionsRaw) {
            if (typeof mention === 'string') {
              if (mention) mentionRoles.add(mention);
            } else if (mention && typeof mention === 'object') {
              const roleRaw = (mention as Record<string, unknown>).role;
              if (typeof roleRaw === 'string' && roleRaw) mentionRoles.add(roleRaw);
            }
          }
        }
        // Scan the comment text for @role tokens (e.g. "@strategist").
        for (const m of text.matchAll(/(?:^|[^\w])@([a-z][a-z0-9-]*)\b/g)) {
          if (m[1]) mentionRoles.add(m[1]);
        }
        mentionRoles.delete('ceo');
        for (const roleRaw of mentionRoles) {
          const agent = getAgent(roleRaw);
          if (!agent) {
            warnings.push(`unknown role: ${roleRaw}`);
            continue;
          }
          const issueKey = `${task.id}-${agent.role}`;
          try {
            const result = resolveSession({
              role: agent.role as AgentRole,
              issueKey,
              prompt: text,
              priority: task.priority,
              taskId: task.id,
            });
            if (result.action === 'blocked') {
              warnings.push(`${agent.role}: ${result.error ?? 'blocked'}`);
              continue;
            }
            if (result.action === 'queued') {
              // task:queued is not yet in the typed event surface — cast.
              (bus as unknown as { emit: (e: string, p: unknown) => void })
                .emit('task:queued', { taskId: task.id, role: agent.role });
              warnings.push(`${agent.role}: queued (capacity full)`);
              continue;
            }
            void bus.emit('task:dispatched', {
              taskId: task.id,
              role: agent.role,
              parentTaskId: task.parentTaskId,
            });
            createNotification({
              kind: 'dispatch',
              title: `Dispatched ${agent.role} on @mention`,
              body: text.length > 200 ? text.slice(0, 200) + '...' : text,
              taskId: task.id,
              agentRole: agent.role,
            });
          } catch (e) {
            warnings.push(`${agent.role}: ${(e as Error).message}`);
          }
        }

        json(res, { comment, ...(warnings.length ? { warnings } : {}) }, 201);
        return true;
      }
    }

    // -- Wave 2A new routes --
    // GET /tasks/:id/attachments and GET /tasks/:id/attachments/:filename
    m = matchRoute('/tasks/:id/attachments', path);
    // The list handler only fires when no `?path=` is provided. With `?path=`
    // the request is a single-attachment read (file or directory) routed
    // through the handler below.
    if (method === 'GET' && m && !url.searchParams.get('path')) {
      const id = m.params.id;
      if (!ENTITY_ID_REGEX.test(id)) { error(res, 'Invalid task id format', 400); return true; }
      const task = getTask(id);
      if (!task) { error(res, 'Task not found', 404); return true; }
      const wsDir = resolveTaskWorkspace(id);
      json(res, { attachments: wsDir ? listWorkspaceFiles(wsDir) : [] });
      return true;
    }

    // Match /tasks/:id/attachments/:filename — `filename` cannot contain
    // slashes via the path matcher, so for nested paths the client must use
    // the query param form: /tasks/:id/attachments?path=sub/dir/file.
    m = matchRoute('/tasks/:id/attachments/:filename', path);
    const isAttachReadByQuery =
      method === 'GET'
      && !m
      && matchRoute('/tasks/:id/attachments', path)
      && (url.searchParams.get('path') ?? '').length > 0;
    if (method === 'GET' && (m || isAttachReadByQuery)) {
      const idMatch = m ?? matchRoute('/tasks/:id/attachments', path)!;
      const id = idMatch.params.id;
      const filename = m
        ? decodeURIComponent(m.params.filename)
        : (url.searchParams.get('path') ?? '');
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
      if (!existsSync(target)) {
        error(res, 'File not found', 404); return true;
      }
      const tStat = statSync(target);
      // Directory: return JSON listing of immediate children.
      if (tStat.isDirectory()) {
        const entries: AttachmentEntry[] = [];
        try {
          for (const name of readdirSync(target)) {
            if (WORKSPACE_SKIP.has(name)) continue;
            const full = join(target, name);
            let s; try { s = statSync(full); } catch { continue; }
            if (s.isDirectory()) {
              entries.push({ name, size: 0, mtime: s.mtimeMs, kind: 'dir' });
            } else {
              entries.push({ name, size: s.size, mtime: s.mtimeMs, kind: classify(extname(name)) });
            }
          }
        } catch { /* ignore */ }
        entries.sort((a, b) => b.mtime - a.mtime);
        json(res, { kind: 'dir', path: filename, entries });
        return true;
      }
      if (!tStat.isFile()) {
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
      // Include idle sessions too — in interactive mode, claude stays alive
      // in tmux even after completing a response (session goes idle but pane
      // still has real output to capture).
      const sessRows = getDb().prepare(
        "SELECT * FROM sessions WHERE task_id = ? AND state IN ('active', 'idle')"
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
        for (const key of [
          'title', 'description', 'priority', 'projectId', 'state',
          'assignee', 'dueDate',
        ] as const) {
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
        // Validate assignee: null or string
        if ('assignee' in patch && patch.assignee !== null && typeof patch.assignee !== 'string') {
          error(res, 'assignee must be a string or null', 400); return true;
        }
        // Validate dueDate: null or yyyy-mm-dd string
        if ('dueDate' in patch && patch.dueDate !== null) {
          if (typeof patch.dueDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(patch.dueDate)) {
            error(res, 'dueDate must be ISO yyyy-mm-dd string or null', 400); return true;
          }
        }
        // Validate labels: array of strings, handled separately
        let labelsPatch: string[] | undefined;
        if ('labels' in body) {
          if (!Array.isArray(body.labels) || !body.labels.every(l => typeof l === 'string')) {
            error(res, 'labels must be string[]', 400); return true;
          }
          labelsPatch = body.labels as string[];
        }
        const updated = updateTask(id, patch as Parameters<typeof updateTask>[1]);
        if (labelsPatch !== undefined) {
          setTaskLabels(id, labelsPatch);
        }
        // Compose final shape with labels included
        const finalLabels = getTaskLabels(id);
        const fullPatch = { ...patch, ...(labelsPatch !== undefined ? { labels: labelsPatch } : {}) };
        // Audit log
        getDb().prepare(
          'INSERT INTO task_events (task_id, role, type, payload) VALUES (?, ?, ?, ?)'
        ).run(id, 'ceo', 'task:updated', JSON.stringify({ by: 'ceo', patch: fullPatch }));
        // Bus emit
        type UpdatedPayload = { taskId: string; patch: Record<string, unknown>; by: string };
        const emitter = bus as unknown as { emit: (e: string, d: UpdatedPayload) => Promise<void> };
        void emitter.emit('task:updated', { taskId: id, patch: fullPatch, by: 'ceo' });
        json(res, { task: { ...updated, labels: finalLabels } });
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
        for (const key of ['name', 'description', 'color', 'icon', 'state', 'health', 'priority', 'lead', 'targetDate'] as const) {
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

    // === Labels ===

    if (method === 'GET' && path === '/labels') {
      json(res, { labels: listLabels() });
      return true;
    }

    if (method === 'POST' && path === '/labels') {
      const body = parseJson(await readBody(req));
      if (!body) { error(res, 'Invalid JSON body', 400); return true; }
      const name = body.name;
      if (typeof name !== 'string' || !name.trim()) {
        error(res, 'name required (string)', 400); return true;
      }
      const color = typeof body.color === 'string' ? body.color : undefined;
      const label = createLabel({ name: name.trim(), color });
      json(res, { label }, 201);
      return true;
    }

    m = matchRoute('/labels/:id', path);
    if (method === 'DELETE' && m) {
      const lid = parseInt(m.params.id);
      if (!Number.isFinite(lid) || lid <= 0) { error(res, 'Invalid label id', 400); return true; }
      const ok = deleteLabel(lid);
      json(res, { ok });
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

    // GET /api/v1/events?limit=50&role=<role>&projectId=<id>&since=<ISO>
    if (path === '/events' && method === 'GET') {
      const limitParam = parseInt(url.searchParams.get('limit') ?? '50');
      const limit = Number.isNaN(limitParam) ? 50 : Math.min(Math.max(limitParam, 1), 500);
      const roleFilter = url.searchParams.get('role') ?? undefined;
      const projectIdFilter = url.searchParams.get('projectId') ?? undefined;
      const sinceFilter = url.searchParams.get('since') ?? undefined;

      // If no filters, fast path
      if (!roleFilter && !projectIdFilter && !sinceFilter) {
        const events = getRecentEvents(limit);
        json(res, { events });
        return true;
      }

      // Filtered events query
      const db = getDb();
      const where: string[] = [];
      const params: unknown[] = [];
      if (roleFilter) {
        where.push('role = ?');
        params.push(roleFilter);
      }
      if (sinceFilter) {
        where.push('created_at >= ?');
        params.push(sinceFilter);
      }
      if (projectIdFilter) {
        // Subquery: events whose issue_key matches any task with that project_id
        where.push(`issue_key IN (SELECT id FROM tasks WHERE project_id = ?)`);
        params.push(projectIdFilter);
      }
      const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
      params.push(limit);
      const rows = db.prepare(
        `SELECT * FROM events ${whereClause} ORDER BY id DESC LIMIT ?`
      ).all(...params) as Array<Record<string, unknown>>;
      const events = rows.map(r => ({
        id: r.id as number,
        eventType: r.event_type as string,
        role: r.role as string | undefined,
        issueKey: r.issue_key as string | undefined,
        detail: r.detail as string | undefined,
        createdAt: r.created_at as string,
      }));
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

    // === Config: Budget ===

    if (method === 'GET' && path === '/config/budget') {
      const summary = getBudgetSummary();
      json(res, {
        config: getBudgetConfig(),
        disabled: isBudgetDisabled(),
        summary: { today: summary.today, perAgent: summary.perAgent },
      });
      return true;
    }

    if (method === 'PATCH' && path === '/config/budget') {
      const body = parseJson(await readBody(req));
      if (!body) { error(res, 'Invalid JSON body', 400); return true; }
      const patch = validateBudgetPatch(body);
      if ('error' in patch) { error(res, patch.error, 400); return true; }
      const updated = saveBudgetConfig(patch.value);
      json(res, { config: updated });
      return true;
    }

    if (method === 'POST' && path === '/config/budget/reset') {
      resetTodayBudget();
      json(res, { ok: true });
      return true;
    }

    // Mark unused to silence TS when only a subset of helpers is used.
    void createNotification;

    // === Wave E: Task self-managed status transitions ===

    m = matchRoute('/tasks/:id/status', path);
    if (method === 'PATCH' && m) {
      if (!ENTITY_ID_REGEX.test(m.params.id)) {
        error(res, 'Invalid task id', 400);
        return true;
      }
      const body = parseJson(await readBody(req));
      if (!body) { error(res, 'Invalid JSON body', 400); return true; }
      const state = body.state;
      const note = body.note;
      const VALID_STATES = ['todo', 'running', 'review', 'done', 'failed', 'canceled', 'suspended'];
      if (typeof state !== 'string' || !VALID_STATES.includes(state)) {
        error(res, `state must be one of: ${VALID_STATES.join(', ')}`, 400);
        return true;
      }
      if (note !== undefined && typeof note !== 'string') {
        error(res, 'note must be a string', 400);
        return true;
      }
      try {
        const result = transitionTaskState(m.params.id, state as TaskState, {
          by: 'api',
          ...(note ? { note } : {}),
        });
        json(res, { task: result.task, from: result.from, to: result.to });
      } catch (e) {
        const msg = (e as Error).message;
        const status = msg.startsWith('task not found') ? 404
          : msg.startsWith('illegal task transition') || msg.includes('already in state') ? 409
          : 400;
        error(res, msg, status);
      }
      return true;
    }

    // === Wave E: Review-strictness configuration ===

    if (method === 'GET' && path === '/config/review') {
      const config = loadReviewConfig();
      json(res, { config, resolvedDefault: config.default });
      return true;
    }

    if (method === 'PATCH' && path === '/config/review') {
      const body = parseJson(await readBody(req));
      if (!body) { error(res, 'Invalid JSON body', 400); return true; }
      const ALLOWED_KEYS = new Set(['default', 'roles', 'projects', 'overrides']);
      for (const k of Object.keys(body)) {
        if (!ALLOWED_KEYS.has(k)) { error(res, `unknown key: ${k}`, 400); return true; }
      }
      try {
        const updated = saveReviewConfig(body as ReviewConfigPatch);
        json(res, { config: updated });
      } catch (e) {
        error(res, (e as Error).message, 400);
      }
      return true;
    }

    if (method === 'POST' && path === '/config/review/reset') {
      const config = resetReviewConfig();
      json(res, { config });
      return true;
    }

    // Silence unused-import warnings for helpers exported for tests/SDK.
    void resolveReviewLevel; void (null as unknown as ReviewLevel);

    // === Wave E: Cross-agent helper wiring ===

    // Agent C: agent role CRUD (config/agents.yaml)
    if (method === 'POST' && path === '/agents/roles') {
      const body = parseJson(await readBody(req));
      if (!body) { error(res, 'Invalid JSON body', 400); return true; }
      try {
        const { createRole } = await import('../core/agent-roles.js');
        const role = await createRole(body as unknown as Parameters<typeof createRole>[0]);
        json(res, { role }, 201);
      } catch (e) {
        error(res, (e as Error).message, 400);
      }
      return true;
    }

    m = matchRoute('/agents/roles/:role', path);
    if (method === 'DELETE' && m) {
      try {
        const { archiveRole } = await import('../core/agent-roles.js');
        const ok = await archiveRole(m.params.role);
        json(res, { ok });
      } catch (e) {
        error(res, (e as Error).message, 400);
      }
      return true;
    }

    // Agent C: persona file CRUD
    m = matchRoute('/personas/:role', path);
    if (method === 'GET' && m) {
      try {
        const { readPersona } = await import('../core/personas.js');
        const body = await readPersona(m.params.role);
        json(res, { role: m.params.role, body });
      } catch (e) {
        const msg = (e as Error).message;
        const status = msg.includes('ENOENT') ? 404 : 400;
        error(res, msg, status);
      }
      return true;
    }
    if (method === 'PATCH' && m) {
      const body = parseJson(await readBody(req));
      if (!body || typeof body.body !== 'string') {
        error(res, 'body (string) required', 400);
        return true;
      }
      try {
        const { writePersona } = await import('../core/personas.js');
        await writePersona(m.params.role, body.body);
        json(res, { ok: true });
      } catch (e) {
        error(res, (e as Error).message, 400);
      }
      return true;
    }

    // Agent C: persona tuner — analyze + per-role suggestions
    m = matchRoute('/personas/:role/suggest', path);
    if (method === 'POST' && m) {
      try {
        const { analyzeScopes } = await import('../core/persona-tuner.js');
        const all = await analyzeScopes();
        const filtered = all.filter(s => s.affectedRoles.includes(m!.params.role));
        json(res, { suggestions: filtered });
      } catch (e) {
        error(res, (e as Error).message, 500);
      }
      return true;
    }
    if (method === 'POST' && path === '/personas/analyze') {
      try {
        const { analyzeScopes } = await import('../core/persona-tuner.js');
        const suggestions = await analyzeScopes();
        json(res, { suggestions });
      } catch (e) {
        error(res, (e as Error).message, 500);
      }
      return true;
    }

    // === Pulse: briefing ===
    if (method === 'GET' && path === '/pulse/briefing') {
      try {
        const { generateBriefing } = await import('../core/briefing.js');
        const force = url.searchParams.get('force') === '1';
        json(res, generateBriefing({ force }));
      } catch (e) {
        error(res, (e as Error).message, 500);
      }
      return true;
    }

    // === Pulse: objectives ===
    if (method === 'GET' && path === '/pulse/objectives') {
      try {
        const { listObjectives } = await import('../core/objectives.js');
        const quarter = url.searchParams.get('quarter') ?? undefined;
        json(res, { objectives: listObjectives(quarter) });
      } catch (e) {
        error(res, (e as Error).message, 500);
      }
      return true;
    }
    if (method === 'POST' && path === '/pulse/objectives') {
      const body = parseJson(await readBody(req));
      if (!body) { error(res, 'Invalid JSON body', 400); return true; }
      try {
        const { createObjective } = await import('../core/objectives.js');
        const obj = createObjective(body as unknown as Parameters<typeof createObjective>[0]);
        json(res, { objective: obj }, 201);
      } catch (e) {
        error(res, (e as Error).message, 400);
      }
      return true;
    }

    m = matchRoute('/pulse/objectives/:id/key-results', path);
    if (method === 'POST' && m) {
      const objectiveId = m.params.id;
      const body = parseJson(await readBody(req));
      if (!body) { error(res, 'Invalid JSON body', 400); return true; }
      try {
        const { addKeyResult } = await import('../core/objectives.js');
        const kr = addKeyResult(objectiveId, body as unknown as Parameters<typeof addKeyResult>[1]);
        json(res, { keyResult: kr }, 201);
      } catch (e) {
        error(res, (e as Error).message, 400);
      }
      return true;
    }

    m = matchRoute('/pulse/key-results/:id', path);
    if (method === 'PATCH' && m) {
      const krId = m.params.id;
      const body = parseJson(await readBody(req));
      if (!body || typeof body.current !== 'number') {
        error(res, 'Body must include numeric `current`', 400);
        return true;
      }
      try {
        const { updateKeyResult } = await import('../core/objectives.js');
        const kr = updateKeyResult(krId, { current: body.current });
        if (!kr) { error(res, 'Key result not found', 404); return true; }
        json(res, { keyResult: kr });
      } catch (e) {
        error(res, (e as Error).message, 400);
      }
      return true;
    }

    // === Pulse: decisions ===
    if (method === 'GET' && path === '/pulse/decisions') {
      try {
        const { listDecisions } = await import('../core/decisions.js');
        const limit = parseInt(url.searchParams.get('limit') ?? '50', 10);
        json(res, { decisions: listDecisions({ limit: Number.isNaN(limit) ? 50 : limit }) });
      } catch (e) {
        error(res, (e as Error).message, 500);
      }
      return true;
    }
    if (method === 'POST' && path === '/pulse/decisions') {
      const body = parseJson(await readBody(req));
      if (!body) { error(res, 'Invalid JSON body', 400); return true; }
      try {
        const { createDecision } = await import('../core/decisions.js');
        const dec = createDecision(body as unknown as Parameters<typeof createDecision>[0]);
        json(res, { decision: dec }, 201);
      } catch (e) {
        error(res, (e as Error).message, 400);
      }
      return true;
    }

    // === Kill switch ===
    if (method === 'POST' && path === '/kill-switch/pause') {
      try {
        const ks = await import('../core/kill-switch.js');
        json(res, ks.pauseAll());
      } catch (e) {
        error(res, (e as Error).message, 500);
      }
      return true;
    }
    if (method === 'POST' && path === '/kill-switch/resume') {
      try {
        const ks = await import('../core/kill-switch.js');
        json(res, ks.resume());
      } catch (e) {
        error(res, (e as Error).message, 500);
      }
      return true;
    }
    if (method === 'GET' && path === '/kill-switch/status') {
      try {
        const ks = await import('../core/kill-switch.js');
        json(res, { paused: ks.isGlobalPaused() });
      } catch (e) {
        error(res, (e as Error).message, 500);
      }
      return true;
    }

    // === Gap Fill: Agent memory CRUD ===
    m = matchRoute('/agents/:role/memory/:filename', path);
    if (m) {
      const role = m.params.role;
      const filename = decodeURIComponent(m.params.filename);
      try {
        const mem = await import('../core/memory.js');
        if (method === 'GET') {
          const result = await mem.readMemoryFile(role, filename);
          if (!result) { error(res, 'Not found', 404); return true; }
          json(res, result);
          return true;
        }
        if (method === 'PUT') {
          const body = parseJson(await readBody(req));
          if (!body || typeof body.body !== 'string') {
            error(res, 'body (string) required', 400); return true;
          }
          const result = await mem.writeMemoryFile(role, filename, body.body);
          json(res, result);
          return true;
        }
        if (method === 'DELETE') {
          const deleted = await mem.deleteMemoryFile(role, filename);
          if (!deleted) { error(res, 'Not found', 404); return true; }
          json(res, { ok: true });
          return true;
        }
      } catch (e) {
        const msg = (e as Error).message;
        const status = msg.includes('invalid') || msg.includes('escape') ? 400 : 500;
        error(res, msg, status);
        return true;
      }
    }

    // === Gap Fill: DELETE /pulse/objectives/:id (soft-delete/archive) ===
    m = matchRoute('/pulse/objectives/:id', path);
    if (method === 'DELETE' && m) {
      try {
        const { archiveObjective } = await import('../core/objectives.js');
        const ok = archiveObjective(m.params.id);
        if (!ok) { error(res, 'Objective not found', 404); return true; }
        json(res, { ok: true });
      } catch (e) {
        error(res, (e as Error).message, 500);
      }
      return true;
    }

    // === Gap Fill: /events?role=<role>&projectId=<id>&since=<ISO> ===
    // (This overrides the earlier /events handler by matching first; we
    //  replace the original block in-line to avoid double-match.)

    // === Gap Fill: /tasks?assignee=<role> (already plumbed into listTasks) ===
    // (The existing GET /tasks handler already reads searchParams; we just need
    //  to add assignee there — handled in the early tasks block.)

    // === Gap Fill: /config/budget/series?role=<role>&days=<n> ===
    if (method === 'GET' && path === '/config/budget/series') {
      const role = url.searchParams.get('role');
      const daysParam = parseInt(url.searchParams.get('days') ?? '14');
      const days = Number.isNaN(daysParam) ? 14 : Math.max(1, Math.min(daysParam, 90));
      try {
        const db = getDb();
        const now = new Date();
        now.setHours(0, 0, 0, 0);
        const startMs = now.getTime() - (days - 1) * 86_400_000;

        const where: string[] = ['created_at >= ?'];
        const params: unknown[] = [startMs];
        if (role) {
          where.push('agent_role = ?');
          params.push(role);
        }

        const rows = db.prepare(`
          SELECT created_at, cost_usd, tokens
          FROM budget_log
          WHERE ${where.join(' AND ')}
        `).all(...params) as Array<{ created_at: number; cost_usd: number; tokens: number }>;

        // Bucket into local-date
        const buckets = new Map<string, { usd: number; tokens: number }>();
        for (const row of rows) {
          const d = new Date(row.created_at);
          const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
          const cur = buckets.get(key) ?? { usd: 0, tokens: 0 };
          cur.usd += row.cost_usd;
          cur.tokens += row.tokens;
          buckets.set(key, cur);
        }

        // Fill in zero days
        const series: Array<{ date: string; usd: number; tokens: number }> = [];
        for (let i = 0; i < days; i++) {
          const d = new Date(startMs + i * 86_400_000);
          const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
          const cur = buckets.get(key) ?? { usd: 0, tokens: 0 };
          series.push({ date: key, ...cur });
        }

        json(res, { role: role ?? 'all', days: series });
      } catch (e) {
        error(res, (e as Error).message, 500);
      }
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
  task: (NonNullable<ReturnType<typeof getTask>> & { labels: string[] }) | null;
  sessions: Array<{
    issueKey: string; role: string; state: string;
    tmuxSession?: string; spawnedAt: number; alive: boolean;
  }>;
  events: Array<Record<string, unknown>>;
  comments: Array<ReturnType<typeof mapCommentRow>>;
  attachments: AttachmentEntry[];
  cost: { totalUsd: number; byAgent: Array<{ role: string; usd: number; tokens: number }> };
  children: Array<NonNullable<ReturnType<typeof getTaskChildren>>[number] & { childCount: number }>;
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

  // Attachments from the first session's workspace (if any). Fall back to the
  // task id itself so orphaned workspaces (session rows lost on restart) still
  // surface their artifacts.
  const firstSessionKey = (sessionRows[0]?.issue_key as string | undefined) ?? task.id;
  let attachments: AttachmentEntry[] = [];
  let handoff: { body: string; actions?: unknown } | null = null;
  {
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

  const childrenRaw = getTaskChildren(task.id);
  const childCounts = getChildCounts(childrenRaw.map(c => c.id));
  const children = childrenRaw.map(c => ({ ...c, childCount: childCounts[c.id] ?? 0 }));
  const labels = getTaskLabels(task.id);

  // Note: filename of the workspace file (basename) used here for clarity.
  void basename;

  // Auto-derive task state from live sessions and workspace artifacts, because
  // agents don't yet self-report status transitions (planned feature).
  //   - any session alive + state==='todo'          → running
  //   - all sessions ended + HANDOFF.md exists      → review
  //   - all sessions ended + workspace has any non-memory artifacts → review
  //   - otherwise                                   → keep stored state
  const anyAlive = sessions.some(s => s.alive);
  const hasDeliverable = handoff !== null || attachments.some(
    a => !a.name.startsWith('.') && !a.name.startsWith('retrospectives/')
  );
  let derivedState: typeof task.state = task.state;
  if (task.state === 'todo') {
    if (anyAlive) derivedState = 'running';
    else if (hasDeliverable) derivedState = 'review';
  }
  const baseTask = derivedState !== task.state ? { ...task, state: derivedState } : task;
  const derivedTask = { ...baseTask, labels };

  return { task: derivedTask, sessions, events, comments, attachments, cost, children, handoff };
}
