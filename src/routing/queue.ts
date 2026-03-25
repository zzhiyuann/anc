/**
 * Priority queue — manages dispatch ordering with dedup.
 * Higher priority (lower number) processes first.
 * Per-role dedup: only one queued item per issue+role.
 */

import type { QueueItem, AgentRole } from '../linear/types.js';
import { bus } from '../bus.js';

const queue: QueueItem[] = [];
let idCounter = 0;

export interface EnqueueParams {
  issueKey: string;
  issueId: string;
  agentRole: AgentRole;
  priority: number;
  context?: string;
}

/** Enqueue a dispatch. Deduplicates by issueKey+role. */
export function enqueue(params: EnqueueParams): QueueItem | null {
  // Dedup: skip if already queued for same issue+role
  const existing = queue.find(
    q => q.issueKey === params.issueKey && q.agentRole === params.agentRole && q.status === 'queued'
  );
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

  queue.push(item);

  // Sort by priority (lower = higher priority), then by creation time
  queue.sort((a, b) => a.priority - b.priority || a.createdAt.localeCompare(b.createdAt));

  bus.emit('queue:enqueued', { issueKey: item.issueKey, role: item.agentRole, priority: item.priority });

  return item;
}

/** Dequeue the next item for a given role (or any role if not specified) */
export function dequeue(role?: AgentRole): QueueItem | null {
  const idx = queue.findIndex(q =>
    q.status === 'queued' && (!role || q.agentRole === role)
  );
  if (idx === -1) return null;

  queue[idx].status = 'processing';
  return queue[idx];
}

/** Mark a queue item as completed */
export function completeItem(id: string): void {
  const item = queue.find(q => q.id === id);
  if (item) item.status = 'completed';
}

/** Mark a queue item as canceled */
export function cancelItem(id: string): void {
  const item = queue.find(q => q.id === id);
  if (item) item.status = 'canceled';
}

/** Cancel all queued items for an issue */
export function cancelByIssue(issueKey: string): number {
  let count = 0;
  for (const item of queue) {
    if (item.issueKey === issueKey && item.status === 'queued') {
      item.status = 'canceled';
      count++;
    }
  }
  return count;
}

/** Get all items (optionally filtered by status) */
export function getQueue(status?: QueueItem['status']): QueueItem[] {
  return status ? queue.filter(q => q.status === status) : [...queue];
}

/** Peek at the next item without dequeuing */
export function peek(role?: AgentRole): QueueItem | null {
  return queue.find(q => q.status === 'queued' && (!role || q.agentRole === role)) ?? null;
}

/** Clean up old completed/canceled items (>1 hour) */
export function cleanup(): number {
  const cutoff = Date.now() - 3600_000;
  const before = queue.length;
  const keep = queue.filter(q =>
    q.status === 'queued' || q.status === 'processing' || new Date(q.createdAt).getTime() > cutoff
  );
  queue.length = 0;
  queue.push(...keep);
  return before - queue.length;
}

/** Reset queue (for testing) */
export function _resetQueue(): void {
  queue.length = 0;
  idCounter = 0;
}
