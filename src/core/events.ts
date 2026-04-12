/**
 * Append-only bus event logger.
 *
 * Subscribes to task-relevant bus events and writes them to the `task_events`
 * table, keyed by task_id (resolved from data.taskId or data.issueKey).
 *
 * Wired from src/index.ts after the bus is imported and before handlers run.
 */

import { getDb } from './db.js';
import { resolveTaskIdFromIssueKey } from './tasks.js';
import { createLogger } from './logger.js';

const log = createLogger('events');

const LOGGED_EVENTS = [
  'agent:spawned',
  'agent:completed',
  'agent:failed',
  'agent:idle',
  'agent:suspended',
  'agent:resumed',
  'queue:enqueued',
  'task:created',
  'task:commented',
  'task:dispatched',
  'task:completed',
  'system:budget-alert',
] as const;

function logEvent(type: string, data: unknown): void {
  try {
    const d = (data ?? {}) as Record<string, unknown>;
    const directTaskId = typeof d.taskId === 'string' ? (d.taskId as string) : undefined;
    const issueKey = typeof d.issueKey === 'string' ? (d.issueKey as string) : undefined;
    const taskId = directTaskId ?? resolveTaskIdFromIssueKey(issueKey);
    if (!taskId) return;
    const role = typeof d.role === 'string' ? (d.role as string) : null;
    getDb().prepare(
      'INSERT INTO task_events (task_id, role, type, payload) VALUES (?, ?, ?, ?)'
    ).run(taskId, role, type, JSON.stringify(d));
  } catch (err) {
    log.warn(`failed to log event ${type}: ${(err as Error).message}`);
  }
}

/**
 * Attach the event logger to a bus. Uses `any` because the bus generic
 * parameter is narrow; we intentionally hook into a curated list of event
 * names and accept that some may not be declared in AncEvents yet.
 */
export function attachEventLogger(bus: { on: (event: string, listener: (data: unknown) => void) => unknown }): void {
  for (const ev of LOGGED_EVENTS) {
    bus.on(ev, (data: unknown) => logEvent(ev, data));
  }
}
