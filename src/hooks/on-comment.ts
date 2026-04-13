/**
 * Comment event handler — routes CEO messages via resolveSession.
 * Detects conversation vs task mode from issue status.
 *
 * Follow-up routing:
 *   Active session + tmux alive → pipe message via sendToAgent (no new spawn)
 *   Active session + tmux dead  → resume with HANDOFF.md context + new comment
 *   No session                  → spawn fresh via resolveSession
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { bus } from '../bus.js';
import { routeComment, type CommentContext } from '../routing/router.js';
import { getSessionForIssue } from '../runtime/health.js';
import { resolveSession } from '../runtime/resolve.js';
import { sessionExists, sendToAgent } from '../runtime/runner.js';
import { getIssue } from '../linear/client.js';
import { downloadCommentImages } from '../linear/images.js';
import { getWorkspacePath } from '../runtime/workspace.js';
import { createLogger } from '../core/logger.js';
import { resolveTaskIdFromIssueKey, addTaskComment } from '../core/tasks.js';
import { getDb } from '../core/db.js';

const log = createLogger('comment');

const CONVERSATION_STATUSES = ['Done', 'In Review', 'Canceled'];

export function registerCommentHandlers(): void {
  bus.on('webhook:comment.created', async ({ comment, issue }) => {
    // Enrich issue data from Linear
    let enrichedIssue = issue;
    if (issue.identifier) {
      const full = await getIssue(issue.identifier);
      if (full) {
        enrichedIssue = {
          ...issue,
          delegateId: full.delegateId,
          assigneeId: full.assigneeId,
          labels: full.labels,
          project: full.project,
          state: full.status,
        };
      }
    }

    const session = issue.identifier ? getSessionForIssue(issue.identifier) : undefined;

    const ctx: CommentContext = {
      comment,
      issue: enrichedIssue,
      lastActiveAgent: session?.role,
    };

    const decision = routeComment(ctx);
    if (decision.target === 'skip') {
      log.debug(`${issue.identifier}: skipped (${decision.reason})`, { issueKey: issue.identifier });
      return;
    }

    log.info(`${issue.identifier} → ${decision.target} (${decision.reason})`, { issueKey: issue.identifier });

    // Download images from comment body
    const workspace = getWorkspacePath(issue.identifier);
    const processedBody = await downloadCommentImages(comment.body, workspace);

    // --- Follow-up routing ---

    if (session && session.state === 'active') {
      // Check if tmux session is actually alive
      if (sessionExists(session.tmuxSession)) {
        // Pipe directly into running session — no new spawn needed
        log.info(`${issue.identifier}: piping follow-up to active session ${session.tmuxSession}`, { issueKey: issue.identifier });
        sendToAgent(session.tmuxSession, `Follow-up from CEO: ${processedBody}`);
        logTaskEvent(issue.identifier, 'task:follow-up', processedBody);
        mirrorComment(issue.identifier, processedBody);
        // Post acknowledgment from agent
        const ackTaskId = resolveTaskIdFromIssueKey(issue.identifier);
        if (ackTaskId && session.role) {
          addTaskComment(ackTaskId, `agent:${session.role}`, 'Received your message. Working on it.');
        }
        return;
      }

      // tmux died but session still tracked as active — resume with context
      log.info(`${issue.identifier}: session dead, resuming with context`, { issueKey: issue.identifier });
      const handoffPath = join(workspace, 'HANDOFF.md');
      let resumePrompt: string;
      if (existsSync(handoffPath)) {
        const handoffContent = readFileSync(handoffPath, 'utf-8');
        const truncated = handoffContent.length > 2000 ? handoffContent.substring(0, 2000) + '...' : handoffContent;
        resumePrompt = `Previous work:\n${truncated}\n\nNew CEO message:\n${processedBody}`;
      } else {
        resumePrompt = `Follow-up from CEO on ${issue.identifier}: ${processedBody}`;
      }

      resolveSession({
        role: decision.target,
        issueKey: issue.identifier,
        prompt: resumePrompt,
        priority: decision.priority,
      });

      logTaskEvent(issue.identifier, 'task:resumed', processedBody);
      mirrorComment(issue.identifier, processedBody);
      return;
    }

    // --- No active session: standard dispatch ---

    // Detect conversation vs task mode
    const issueStatus = enrichedIssue.state ?? '';
    const isConversation = CONVERSATION_STATUSES.includes(issueStatus);

    const prompt = isConversation
      ? `CEO asks on ${issue.identifier}: ${processedBody}\n\nJust answer the question. No HANDOFF needed.`
      : `Follow-up from CEO on ${issue.identifier}: ${processedBody}`;

    resolveSession({
      role: decision.target,
      issueKey: issue.identifier,
      prompt,
      priority: decision.priority,
    });

    logTaskEvent(issue.identifier, 'task:dispatched', processedBody);
    mirrorComment(issue.identifier, processedBody);
  });
}

// --- Helpers ---

/** Log a lifecycle event to task_events (best-effort). */
function logTaskEvent(issueKey: string, eventType: string, body: string): void {
  try {
    const taskId = resolveTaskIdFromIssueKey(issueKey);
    if (!taskId) return;
    getDb().prepare(
      'INSERT INTO task_events (task_id, role, type, payload) VALUES (?, ?, ?, ?)'
    ).run(taskId, 'ceo', eventType, JSON.stringify({ body: body.substring(0, 500) }));
  } catch (err) {
    log.warn(`logTaskEvent(${eventType}) failed: ${(err as Error).message}`);
  }
}

/** Mirror the comment into task_comments for the dashboard. */
function mirrorComment(issueKey: string, body: string): void {
  try {
    const taskId = resolveTaskIdFromIssueKey(issueKey);
    if (taskId) {
      const result = getDb().prepare(
        'INSERT INTO task_comments (task_id, author, body) VALUES (?, ?, ?)'
      ).run(taskId, 'ceo', body);
      const commentId = Number(result.lastInsertRowid);
      void bus.emit('task:commented', {
        taskId,
        author: 'ceo',
        body,
        commentId,
      });
    }
  } catch (err) {
    log.warn(`task_comments mirror failed: ${(err as Error).message}`);
  }
}
