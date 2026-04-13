/**
 * Task entity CRUD.
 *
 * Tasks are first-class objects. One task may have many sessions (multi-agent).
 * See docs: plan whimsical-sleeping-spindle.md for context.
 */

import { randomUUID } from 'node:crypto';
import { getDb } from './db.js';
import { bus } from '../bus.js';

export type TaskState = 'todo' | 'running' | 'review' | 'done' | 'failed' | 'canceled';
export type TaskSource = 'dashboard' | 'linear' | 'dispatch' | 'duty';

export interface Task {
  id: string;
  projectId: string | null;
  title: string;
  description: string | null;
  state: TaskState;
  priority: number;
  source: TaskSource;
  parentTaskId: string | null;
  createdBy: string;
  linearIssueKey: string | null;
  createdAt: number;
  completedAt: number | null;
  handoffSummary: string | null;
}

function rowToTask(r: Record<string, unknown>): Task {
  return {
    id: r.id as string,
    projectId: (r.project_id as string | null) ?? null,
    title: r.title as string,
    description: (r.description as string | null) ?? null,
    state: r.state as TaskState,
    priority: r.priority as number,
    source: r.source as TaskSource,
    parentTaskId: (r.parent_task_id as string | null) ?? null,
    createdBy: r.created_by as string,
    linearIssueKey: (r.linear_issue_key as string | null) ?? null,
    createdAt: r.created_at as number,
    completedAt: (r.completed_at as number | null) ?? null,
    handoffSummary: (r.handoff_summary as string | null) ?? null,
  };
}

export function createTask(input: Partial<Task> & { title: string }): Task {
  const id = input.id ?? `task-${randomUUID()}`;
  const createdAt = input.createdAt ?? Date.now();
  const state: TaskState = input.state ?? 'todo';
  const priority = input.priority ?? 3;
  const source: TaskSource = input.source ?? 'dashboard';
  const createdBy = input.createdBy ?? 'ceo';

  getDb().prepare(`
    INSERT INTO tasks (
      id, project_id, title, description, state, priority, source,
      parent_task_id, created_by, linear_issue_key, created_at, completed_at, handoff_summary
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.projectId ?? null,
    input.title,
    input.description ?? null,
    state,
    priority,
    source,
    input.parentTaskId ?? null,
    createdBy,
    input.linearIssueKey ?? null,
    createdAt,
    input.completedAt ?? null,
    input.handoffSummary ?? null,
  );

  return getTask(id)!;
}

export function getTask(id: string): Task | null {
  const row = getDb().prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? rowToTask(row) : null;
}

export function listTasks(filter: { projectId?: string; state?: TaskState; limit?: number } = {}): Task[] {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filter.projectId !== undefined) {
    where.push('project_id = ?');
    params.push(filter.projectId);
  }
  if (filter.state !== undefined) {
    where.push('state = ?');
    params.push(filter.state);
  }
  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const limitClause = filter.limit ? `LIMIT ${Math.max(1, Math.floor(filter.limit))}` : '';
  const rows = getDb().prepare(
    `SELECT * FROM tasks ${whereClause} ORDER BY created_at DESC ${limitClause}`
  ).all(...params) as Array<Record<string, unknown>>;
  return rows.map(rowToTask);
}

export function updateTask(id: string, patch: Partial<Task>): Task | null {
  const current = getTask(id);
  if (!current) return null;

  const fieldMap: Record<string, string> = {
    projectId: 'project_id',
    title: 'title',
    description: 'description',
    state: 'state',
    priority: 'priority',
    source: 'source',
    parentTaskId: 'parent_task_id',
    createdBy: 'created_by',
    linearIssueKey: 'linear_issue_key',
    completedAt: 'completed_at',
    handoffSummary: 'handoff_summary',
  };

  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [key, col] of Object.entries(fieldMap)) {
    if (key in patch) {
      sets.push(`${col} = ?`);
      params.push((patch as Record<string, unknown>)[key] ?? null);
    }
  }
  if (sets.length === 0) return current;
  params.push(id);
  getDb().prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  return getTask(id);
}

export function setTaskState(id: string, state: TaskState, completedAt?: number): void {
  if (state === 'done' || state === 'failed' || state === 'canceled') {
    getDb().prepare('UPDATE tasks SET state = ?, completed_at = ? WHERE id = ?')
      .run(state, completedAt ?? Date.now(), id);
  } else {
    getDb().prepare('UPDATE tasks SET state = ? WHERE id = ?').run(state, id);
  }
}

// --- State transitions ---

/**
 * Legal task state transitions. `done`, `failed` and `canceled` are terminal —
 * they have no entry in this map and reject any outbound transition.
 */
const LEGAL_TRANSITIONS: Record<TaskState, ReadonlySet<TaskState>> = {
  todo: new Set<TaskState>(['running', 'canceled']),
  running: new Set<TaskState>(['review', 'done', 'failed', 'suspended' as TaskState, 'canceled']),
  review: new Set<TaskState>(['done', 'running', 'canceled']),
  // `suspended` is a runtime-only state not currently in the TaskState union;
  // it is accepted here to support the documented matrix and round-trips back
  // to `running`. Cast through unknown to keep the column free-form.
  ['suspended' as TaskState]: new Set<TaskState>(['running', 'canceled']),
  done: new Set<TaskState>(),
  failed: new Set<TaskState>(),
  canceled: new Set<TaskState>(),
};

export interface TransitionOpts {
  /** Who initiated the transition. Defaults to "system". */
  by?: string;
  /** Optional free-form note recorded in the task_events payload. */
  note?: string;
}

export interface TransitionResult {
  task: Task;
  from: TaskState;
  to: TaskState;
}

/**
 * Move a task between states with validation, event emission, and audit log.
 * Throws on unknown task or illegal transition. Idempotent same-state
 * transitions are also rejected — callers should check first.
 */
export function transitionTaskState(
  taskId: string,
  nextState: TaskState,
  opts: TransitionOpts = {},
): TransitionResult {
  const current = getTask(taskId);
  if (!current) {
    throw new Error(`task not found: ${taskId}`);
  }
  const from = current.state;
  if (from === nextState) {
    throw new Error(`task ${taskId} already in state ${from}`);
  }
  const allowed = LEGAL_TRANSITIONS[from];
  if (!allowed || !allowed.has(nextState)) {
    throw new Error(
      `illegal task transition: ${from} -> ${nextState} (task ${taskId})`,
    );
  }

  const db = getDb();
  const isTerminal = nextState === 'done' || nextState === 'failed' || nextState === 'canceled';
  if (isTerminal) {
    db.prepare('UPDATE tasks SET state = ?, completed_at = ? WHERE id = ?')
      .run(nextState, Date.now(), taskId);
  } else {
    db.prepare('UPDATE tasks SET state = ? WHERE id = ?').run(nextState, taskId);
  }

  const by = opts.by ?? 'system';
  const payload = JSON.stringify({ from, to: nextState, by, ...(opts.note ? { note: opts.note } : {}) });
  db.prepare(
    'INSERT INTO task_events (task_id, role, type, payload) VALUES (?, ?, ?, ?)'
  ).run(taskId, by, 'task:state-changed', payload);

  // Emit on bus. The `task:status-changed` event is added at runtime; the
  // bus's typed surface doesn't currently list it, so we cast to escape the
  // generic constraint without touching bus.ts.
  type StatusChangedPayload = { taskId: string; from: TaskState; to: TaskState; by: string };
  const emitter = bus as unknown as {
    emit: (event: string, data: StatusChangedPayload) => Promise<void>;
  };
  void emitter.emit('task:status-changed', { taskId, from, to: nextState, by });

  const updated = getTask(taskId)!;
  return { task: updated, from, to: nextState };
}

/** Read-only view of the legal-transitions matrix, primarily for tests. */
export function getLegalTransitions(state: TaskState): TaskState[] {
  return Array.from(LEGAL_TRANSITIONS[state] ?? []);
}

export function getTaskChildren(parentId: string): Task[] {
  const rows = getDb().prepare(
    'SELECT * FROM tasks WHERE parent_task_id = ? ORDER BY created_at ASC'
  ).all(parentId) as Array<Record<string, unknown>>;
  return rows.map(rowToTask);
}

/**
 * Hard-delete a task and its dependent rows. Returns true if a row was removed.
 *
 * The schema declares FK references but no ON DELETE CASCADE, so we manually
 * remove task_events, task_comments and detach sessions/notifications first.
 */
export function deleteTask(id: string): boolean {
  const db = getDb();
  const tx = db.transaction((taskId: string): boolean => {
    db.prepare('DELETE FROM task_events WHERE task_id = ?').run(taskId);
    db.prepare('DELETE FROM task_comments WHERE task_id = ?').run(taskId);
    // Detach sessions/notifications instead of deleting them — preserves history.
    try { db.prepare('UPDATE sessions SET task_id = NULL WHERE task_id = ?').run(taskId); } catch { /* table may lack column */ }
    try { db.prepare('UPDATE notifications SET task_id = NULL WHERE task_id = ?').run(taskId); } catch { /* ignore */ }
    const result = db.prepare('DELETE FROM tasks WHERE id = ?').run(taskId);
    return result.changes > 0;
  });
  return tx(id);
}

/** Resolve task_id from either a direct taskId or a linear_issue_key. */
export function resolveTaskIdFromIssueKey(issueKey: string | undefined | null): string | null {
  if (!issueKey) return null;
  const row = getDb().prepare(
    'SELECT id FROM tasks WHERE linear_issue_key = ? OR id = ? LIMIT 1'
  ).get(issueKey, issueKey) as { id: string } | undefined;
  if (row) return row.id;
  // Fall back to sessions.task_id for migrated rows
  const sessRow = getDb().prepare(
    'SELECT task_id FROM sessions WHERE issue_key = ? LIMIT 1'
  ).get(issueKey) as { task_id: string | null } | undefined;
  return sessRow?.task_id ?? null;
}
