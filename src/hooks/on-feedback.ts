/**
 * Child→Parent feedback loop.
 *
 * When a child task completes, notify the parent agent:
 *   - If parent's tmux session is alive → pipe feedback via sendToAgent
 *   - If parent's tmux session is dead  → store as pending in task_events
 *
 * When all children of a parent complete → emit task:all-children-done.
 */

import { bus } from '../bus.js';
import { getDb } from '../core/db.js';
import { getTask, getTaskChildren } from '../core/tasks.js';
import { getSessionForIssue } from '../runtime/health.js';
import { sessionExists, sendToAgent } from '../runtime/runner.js';
import { createLogger } from '../core/logger.js';

const log = createLogger('feedback');

export function registerFeedbackHandlers(): void {
  bus.on('task:completed', ({ taskId, handoffSummary }) => {
    try {
      deliverFeedbackToParent(taskId, handoffSummary);
    } catch (err) {
      log.warn(`feedback delivery failed for ${taskId}: ${(err as Error).message}`);
    }
  });
}

function deliverFeedbackToParent(childTaskId: string, summary: string | null): void {
  const child = getTask(childTaskId);
  if (!child || !child.parentTaskId) return;

  const parent = getTask(child.parentTaskId);
  if (!parent) return;

  const feedbackText = `Sub-task completed: ${child.title}. Summary: ${summary ?? 'No summary provided.'}`;

  // Try to find a live session for the parent task
  const parentIssueKey = parent.linearIssueKey ?? parent.id;
  const session = getSessionForIssue(parentIssueKey);

  if (session && session.state === 'active' && sessionExists(session.tmuxSession)) {
    // Parent agent is alive — deliver immediately
    const sent = sendToAgent(session.tmuxSession, feedbackText);
    if (sent) {
      storeFeedbackEvent(child.parentTaskId, childTaskId, feedbackText, 'task:feedback-delivered');
      log.info(`Delivered feedback to parent ${child.parentTaskId} for child ${childTaskId}`);
    } else {
      // Send failed — store as pending
      storeFeedbackEvent(child.parentTaskId, childTaskId, feedbackText, 'task:feedback-pending');
      log.info(`Parent session send failed, stored pending feedback for ${child.parentTaskId}`);
    }
  } else {
    // Parent session is dead or not found — store as pending
    storeFeedbackEvent(child.parentTaskId, childTaskId, feedbackText, 'task:feedback-pending');
    log.info(`Parent session dead/missing, stored pending feedback for ${child.parentTaskId}`);
  }

  // Check if ALL children of the parent are now done
  checkAllChildrenDone(child.parentTaskId);
}

function storeFeedbackEvent(parentTaskId: string, childTaskId: string, text: string, type: string): void {
  getDb().prepare(
    'INSERT INTO task_events (task_id, role, type, payload) VALUES (?, ?, ?, ?)'
  ).run(parentTaskId, 'system', type, JSON.stringify({ childTaskId, text }));
}

function checkAllChildrenDone(parentTaskId: string): void {
  const children = getTaskChildren(parentTaskId);
  if (children.length === 0) return;

  const allDone = children.every(c => c.state === 'done' || c.state === 'canceled');
  if (allDone) {
    const summaries = children
      .filter(c => c.state === 'done')
      .map(c => `- ${c.title}: ${c.handoffSummary ?? 'completed'}`)
      .join('\n');

    const synthesisMsg = `All ${children.length} sub-tasks completed:\n${summaries}`;

    // Try to deliver synthesis to parent
    const parent = getTask(parentTaskId);
    if (parent) {
      const parentIssueKey = parent.linearIssueKey ?? parent.id;
      const session = getSessionForIssue(parentIssueKey);
      if (session && session.state === 'active' && sessionExists(session.tmuxSession)) {
        sendToAgent(session.tmuxSession, synthesisMsg);
      }
    }

    void bus.emit('task:all-children-done', { parentTaskId });
    log.info(`All children done for parent ${parentTaskId}`);
  }
}

/**
 * Deliver any pending feedback for a task. Called when a session resumes.
 * Returns number of feedback items delivered.
 */
export function deliverPendingFeedback(taskId: string, tmuxSession: string): number {
  const rows = getDb().prepare(
    "SELECT id, payload FROM task_events WHERE task_id = ? AND type = 'task:feedback-pending' ORDER BY created_at ASC"
  ).all(taskId) as Array<{ id: number; payload: string }>;

  let delivered = 0;
  for (const row of rows) {
    try {
      const data = JSON.parse(row.payload) as { text: string; childTaskId: string };
      const sent = sendToAgent(tmuxSession, data.text);
      if (sent) {
        // Mark as delivered
        getDb().prepare(
          'INSERT INTO task_events (task_id, role, type, payload) VALUES (?, ?, ?, ?)'
        ).run(taskId, 'system', 'task:feedback-delivered', row.payload);
        // Remove the pending entry
        getDb().prepare('DELETE FROM task_events WHERE id = ?').run(row.id);
        delivered++;
      }
    } catch {
      // Skip malformed entries
    }
  }

  if (delivered > 0) {
    log.info(`Delivered ${delivered} pending feedback items to task ${taskId}`);
  }

  return delivered;
}
