/**
 * Task entity CRUD.
 *
 * Tasks are first-class objects. One task may have many sessions (multi-agent).
 * See docs: plan whimsical-sleeping-spindle.md for context.
 */

import { randomUUID } from 'node:crypto';
import { getDb } from './db.js';

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

export function getTaskChildren(parentId: string): Task[] {
  const rows = getDb().prepare(
    'SELECT * FROM tasks WHERE parent_task_id = ? ORDER BY created_at ASC'
  ).all(parentId) as Array<Record<string, unknown>>;
  return rows.map(rowToTask);
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
