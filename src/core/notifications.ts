/**
 * Notifications CRUD.
 *
 * Notifications are surfaced in the dashboard inbox. They are created by
 * bus event handlers (see hooks/on-notifications.ts) and by explicit callers.
 */

import { getDb } from './db.js';

export type NotificationKind =
  | 'mention' | 'alert' | 'briefing' | 'completion'
  | 'failure' | 'dispatch' | 'queue' | 'budget' | 'a2a'
  | 'circuit-breaker' | 'kill-switch' | 'stuck';
export type NotificationSeverity = 'info' | 'warning' | 'critical';

export interface Notification {
  id: number;
  kind: NotificationKind;
  severity: NotificationSeverity;
  title: string;
  body: string | null;
  taskId: string | null;
  projectId: string | null;
  agentRole: string | null;
  readAt: number | null;
  archivedAt: number | null;
  createdAt: number;
}

function rowToNotification(r: Record<string, unknown>): Notification {
  return {
    id: r.id as number,
    kind: r.kind as NotificationKind,
    severity: r.severity as NotificationSeverity,
    title: r.title as string,
    body: (r.body as string | null) ?? null,
    taskId: (r.task_id as string | null) ?? null,
    projectId: (r.project_id as string | null) ?? null,
    agentRole: (r.agent_role as string | null) ?? null,
    readAt: (r.read_at as number | null) ?? null,
    archivedAt: (r.archived_at as number | null) ?? null,
    createdAt: r.created_at as number,
  };
}

export interface CreateNotificationInput {
  kind: NotificationKind;
  title: string;
  severity?: NotificationSeverity;
  body?: string | null;
  taskId?: string | null;
  projectId?: string | null;
  agentRole?: string | null;
}

export function createNotification(input: CreateNotificationInput): Notification {
  const severity: NotificationSeverity = input.severity ?? 'info';
  const createdAt = Date.now();
  const result = getDb().prepare(`
    INSERT INTO notifications (kind, severity, title, body, task_id, project_id, agent_role, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.kind,
    severity,
    input.title,
    input.body ?? null,
    input.taskId ?? null,
    input.projectId ?? null,
    input.agentRole ?? null,
    createdAt,
  );
  const id = Number(result.lastInsertRowid);
  return getNotification(id)!;
}

export function getNotification(id: number): Notification | null {
  const row = getDb().prepare('SELECT * FROM notifications WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? rowToNotification(row) : null;
}

export interface NotificationFilter {
  read?: boolean;       // true = only read; false = only unread
  archived?: boolean;   // true = only archived; false = only non-archived
  limit?: number;
}

export function listNotifications(filter: NotificationFilter = {}): Notification[] {
  const where: string[] = [];
  if (filter.read === true) where.push('read_at IS NOT NULL');
  else if (filter.read === false) where.push('read_at IS NULL');
  if (filter.archived === true) where.push('archived_at IS NOT NULL');
  else if (filter.archived === false) where.push('archived_at IS NULL');
  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const limit = filter.limit ? Math.max(1, Math.floor(filter.limit)) : 100;
  const rows = getDb().prepare(
    `SELECT * FROM notifications ${whereClause} ORDER BY created_at DESC LIMIT ${limit}`
  ).all() as Array<Record<string, unknown>>;
  return rows.map(rowToNotification);
}

export function getUnreadCount(): number {
  const row = getDb().prepare(
    'SELECT COUNT(*) AS n FROM notifications WHERE read_at IS NULL AND archived_at IS NULL'
  ).get() as { n: number };
  return row.n;
}

export function markRead(id: number): void {
  getDb().prepare('UPDATE notifications SET read_at = ? WHERE id = ? AND read_at IS NULL')
    .run(Date.now(), id);
}

export function markAllRead(): number {
  const result = getDb().prepare(
    'UPDATE notifications SET read_at = ? WHERE read_at IS NULL AND archived_at IS NULL'
  ).run(Date.now());
  return result.changes;
}

export function archiveNotification(id: number): void {
  const now = Date.now();
  getDb().prepare(
    'UPDATE notifications SET archived_at = ?, read_at = COALESCE(read_at, ?) WHERE id = ?'
  ).run(now, now, id);
}
