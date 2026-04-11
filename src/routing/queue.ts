/**
 * Priority queue — SQLite-backed dispatch ordering with dedup, delay, and cooldown.
 * Higher priority (lower number) processes first.
 * Per-role dedup: only one queued item per issue+role.
 *
 * Priority levels:
 *   1 = CEO-assigned
 *   2 = Urgent
 *   3 = Normal (default)
 *   5 = Duty / background
 */

import type { QueueItem, AgentRole } from '../linear/types.js';
import { bus } from '../bus.js';
import { getDb, saveQueueItem, loadQueueItems, deleteQueueItem, clearOldQueueItems } from '../core/db.js';

export const PRIORITY = {
  CEO_ASSIGNED: 1,
  URGENT: 2,
  NORMAL: 3,
  DUTY: 5,
} as const;

let idCounter = 0;

// Per-issue cooldown map (in-memory, no need to persist)
const cooldowns = new Map<string, number>();

export interface EnqueueParams {
  issueKey: string;
  issueId: string;
  agentRole: AgentRole;
  priority: number;
  context?: string;
  delayUntil?: string;  // ISO timestamp — item won't be dequeued until this time
}

/** Set a cooldown on an issue — no dispatches for this issue during the window */
export function setCooldown(issueKey: string, durationMs: number): void {
  cooldowns.set(issueKey, Date.now() + durationMs);
}

/** Check if an issue is in cooldown */
export function isInCooldown(issueKey: string): boolean {
  const until = cooldowns.get(issueKey);
  if (!until) return false;
  if (Date.now() >= until) {
    cooldowns.delete(issueKey);
    return false;
  }
  return true;
}

/** Get cooldown remaining in ms (0 if not in cooldown) */
export function getCooldownRemaining(issueKey: string): number {
  const until = cooldowns.get(issueKey);
  if (!until) return 0;
  const remaining = until - Date.now();
  if (remaining <= 0) {
    cooldowns.delete(issueKey);
    return 0;
  }
  return remaining;
}

/** Enqueue a dispatch. Deduplicates by issueKey+role. Persists to SQLite. */
export function enqueue(params: EnqueueParams): QueueItem | null {
  if (isInCooldown(params.issueKey)) return null;

  // Dedup: check SQLite for existing queued item with same issue+role
  const d = getDb();
  const existing = d.prepare(
    "SELECT id FROM queue WHERE issue_key = ? AND agent_role = ? AND status = 'queued'"
  ).get(params.issueKey, params.agentRole) as { id: string } | undefined;
  if (existing) return null;

  const item: QueueItem = {
    id: `q-${++idCounter}-${Date.now()}`,
    issueKey: params.issueKey,
    issueId: params.issueId,
    agentRole: params.agentRole,
    priority: params.priority,
    context: params.context,
    createdAt: new Date().toISOString(),
    status: 'queued',
  };

  // Persist with delay_until support
  if (params.delayUntil) {
    d.prepare(`
      INSERT OR REPLACE INTO queue (id, issue_key, issue_id, agent_role, priority, context, created_at, status, delay_until)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(item.id, item.issueKey, item.issueId, item.agentRole, item.priority, item.context ?? null, item.createdAt, item.status, params.delayUntil);
  } else {
    saveQueueItem(item);
  }

  bus.emit('queue:enqueued', { issueKey: item.issueKey, role: item.agentRole, priority: item.priority });

  return item;
}

/** Dequeue the next item for a given role (or any role). Respects delay_until. */
export function dequeue(role?: AgentRole): QueueItem | null {
  const d = getDb();
  const now = new Date().toISOString();

  const row = role
    ? d.prepare(`
        SELECT * FROM queue
        WHERE status = 'queued' AND agent_role = ? AND (delay_until IS NULL OR delay_until <= ?)
        ORDER BY priority ASC, created_at ASC LIMIT 1
      `).get(role, now) as Record<string, unknown> | undefined
    : d.prepare(`
        SELECT * FROM queue
        WHERE status = 'queued' AND (delay_until IS NULL OR delay_until <= ?)
        ORDER BY priority ASC, created_at ASC LIMIT 1
      `).get(now) as Record<string, unknown> | undefined;

  if (!row) return null;

  // Mark processing in DB
  d.prepare("UPDATE queue SET status = 'processing' WHERE id = ?").run(row.id);

  return rowToItem({ ...row, status: 'processing' });
}

/** Mark a queue item as completed */
export function completeItem(id: string): void {
  getDb().prepare("UPDATE queue SET status = 'completed' WHERE id = ?").run(id);
}

/** Mark a queue item as canceled */
export function cancelItem(id: string): void {
  getDb().prepare("UPDATE queue SET status = 'canceled' WHERE id = ?").run(id);
}

/** Cancel all queued items for an issue */
export function cancelByIssue(issueKey: string): number {
  const result = getDb().prepare(
    "UPDATE queue SET status = 'canceled' WHERE issue_key = ? AND status = 'queued'"
  ).run(issueKey);
  return result.changes;
}

/** Get all items (optionally filtered by status) */
export function getQueue(status?: QueueItem['status']): QueueItem[] {
  const d = getDb();
  const rows = status
    ? d.prepare('SELECT * FROM queue WHERE status = ? ORDER BY priority ASC, created_at ASC').all(status) as Array<Record<string, unknown>>
    : d.prepare('SELECT * FROM queue ORDER BY priority ASC, created_at ASC').all() as Array<Record<string, unknown>>;
  return rows.map(rowToItem);
}

/** Peek at the next item without dequeuing. Respects delay_until. */
export function peek(role?: AgentRole): QueueItem | null {
  const d = getDb();
  const now = new Date().toISOString();

  const row = role
    ? d.prepare(`
        SELECT * FROM queue
        WHERE status = 'queued' AND agent_role = ? AND (delay_until IS NULL OR delay_until <= ?)
        ORDER BY priority ASC, created_at ASC LIMIT 1
      `).get(role, now) as Record<string, unknown> | undefined
    : d.prepare(`
        SELECT * FROM queue
        WHERE status = 'queued' AND (delay_until IS NULL OR delay_until <= ?)
        ORDER BY priority ASC, created_at ASC LIMIT 1
      `).get(now) as Record<string, unknown> | undefined;

  return row ? rowToItem(row) : null;
}

/** Clean up old completed/canceled items (>1 hour) */
export function cleanup(): number {
  return clearOldQueueItems(3600_000);
}

/** Get queue length for queued items */
export function getQueueLength(): number {
  const row = getDb().prepare("SELECT COUNT(*) as count FROM queue WHERE status = 'queued'").get() as { count: number };
  return row.count;
}

/** Reset queue (for testing) */
export function _resetQueue(): void {
  getDb().prepare('DELETE FROM queue').run();
  cooldowns.clear();
  idCounter = 0;
}

// --- Helpers ---

function rowToItem(r: Record<string, unknown>): QueueItem {
  return {
    id: r.id as string,
    issueKey: r.issue_key as string,
    issueId: (r.issue_id as string) ?? '',
    agentRole: r.agent_role as string,
    priority: r.priority as number,
    context: r.context as string | undefined,
    createdAt: r.created_at as string,
    status: r.status as QueueItem['status'],
  };
}
