/**
 * Comment event handler — routes CEO messages via resolveSession.
 * Detects conversation vs task mode from issue status.
 */

import { bus } from '../bus.js';
import { routeComment, type CommentContext } from '../routing/router.js';
import { getSessionForIssue } from '../runtime/health.js';
import { resolveSession } from '../runtime/runner.js';
import { getIssue } from '../linear/client.js';
import { downloadCommentImages } from '../linear/images.js';
import { getWorkspacePath } from '../runtime/workspace.js';
import { createLogger } from '../core/logger.js';

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
  });
}
