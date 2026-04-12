/**
 * Notifications hook — creates Notification rows from bus events.
 *
 * Keeps the dashboard inbox in sync. Each handler creates a notification
 * via createNotification() and re-emits notification:created on the bus
 * so websocket clients can push in real time.
 */

import { bus } from '../bus.js';
import { createNotification } from '../core/notifications.js';
import { resolveTaskIdFromIssueKey, getTask } from '../core/tasks.js';
import { getDb } from '../core/db.js';
import { createLogger } from '../core/logger.js';

const log = createLogger('notifications-hook');

// Track failure counts per task/issue — escalate to critical after 3.
const failCounts = new Map<string, number>();

/** Track queue depth across enqueues — warn once when it crosses 5. */
let lastQueueNotifyAt = 0;
const QUEUE_NOTIFY_COOLDOWN_MS = 60_000;

function emitCreated(n: { id: number; kind: string; severity: string; title: string; taskId: string | null }): void {
  // Fire and forget — bus handlers run concurrently.
  void bus.emit('notification:created', {
    id: n.id,
    kind: n.kind,
    severity: n.severity,
    title: n.title,
    taskId: n.taskId,
  });
}

export function registerNotificationHandlers(): void {
  // --- Agent failed → failure notification ---
  bus.on('agent:failed', ({ role, issueKey, error }) => {
    try {
      const taskId = resolveTaskIdFromIssueKey(issueKey);
      const key = taskId ?? issueKey;
      const count = (failCounts.get(key) ?? 0) + 1;
      failCounts.set(key, count);
      const severity = count >= 3 ? 'critical' : 'info';
      const n = createNotification({
        kind: 'failure',
        severity,
        title: `${role} failed on ${issueKey}`,
        body: error,
        taskId,
        agentRole: role,
      });
      emitCreated(n);
    } catch (err) {
      log.warn(`on-failed: ${(err as Error).message}`);
    }
  });

  // --- Agent completed → completion notification (only for CEO-created tasks) ---
  bus.on('agent:completed', ({ role, issueKey, handoff }) => {
    try {
      const taskId = resolveTaskIdFromIssueKey(issueKey);
      if (!taskId) return;
      const task = getTask(taskId);
      if (!task || task.createdBy !== 'ceo') return;
      // Reset failure counter on success.
      failCounts.delete(taskId);
      const summary = handoff.split('\n').find(l => l.trim().length > 0) ?? 'Task completed';
      const n = createNotification({
        kind: 'completion',
        severity: 'info',
        title: `${role} finished ${task.title}`,
        body: summary.substring(0, 500),
        taskId,
        projectId: task.projectId,
        agentRole: role,
      });
      emitCreated(n);
    } catch (err) {
      log.warn(`on-completed: ${(err as Error).message}`);
    }
  });

  // --- Budget alerts → warning/critical ---
  bus.on('system:budget-alert', ({ agentRole, spent, limit, percent }) => {
    try {
      let severity: 'info' | 'warning' | 'critical' = 'info';
      if (percent >= 90) severity = 'critical';
      else if (percent >= 70) severity = 'warning';
      else return; // below threshold: no notification
      const title = agentRole
        ? `Budget alert — ${agentRole} at ${percent.toFixed(0)}%`
        : `Daily budget at ${percent.toFixed(0)}%`;
      const body = `Spent $${spent.toFixed(2)} of $${Number(limit).toFixed(2)}`;
      const n = createNotification({
        kind: 'budget',
        severity,
        title,
        body,
        agentRole: agentRole ?? null,
      });
      emitCreated(n);
    } catch (err) {
      log.warn(`on-budget: ${(err as Error).message}`);
    }
  });

  // --- Task dispatched → info notification ---
  bus.on('task:dispatched', ({ taskId, role, parentTaskId }) => {
    try {
      const task = getTask(taskId);
      const title = task
        ? `${role} dispatched on ${task.title}`
        : `${role} dispatched on ${taskId}`;
      const body = parentTaskId ? `Child of ${parentTaskId}` : null;
      const n = createNotification({
        kind: 'dispatch',
        severity: 'info',
        title,
        body,
        taskId,
        projectId: task?.projectId ?? null,
        agentRole: role,
      });
      emitCreated(n);
    } catch (err) {
      log.warn(`on-dispatched: ${(err as Error).message}`);
    }
  });

  // --- Queue depth warning ---
  bus.on('queue:enqueued', () => {
    try {
      const row = getDb().prepare(
        "SELECT COUNT(*) AS n FROM queue WHERE status = 'queued'"
      ).get() as { n: number };
      if (row.n < 5) return;
      const now = Date.now();
      if (now - lastQueueNotifyAt < QUEUE_NOTIFY_COOLDOWN_MS) return;
      lastQueueNotifyAt = now;
      const n = createNotification({
        kind: 'queue',
        severity: 'warning',
        title: `Queue depth at ${row.n}`,
        body: 'Agents are backlogged — consider raising capacity or reviewing stuck items.',
      });
      emitCreated(n);
    } catch (err) {
      log.warn(`on-enqueued: ${(err as Error).message}`);
    }
  });
}

/** Test helper: clear in-memory counters. */
export function _resetNotificationHookState(): void {
  failCounts.clear();
  lastQueueNotifyAt = 0;
}
