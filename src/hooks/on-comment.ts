/**
 * Comment event handler — routes CEO messages to the right agent.
 */

import { bus } from '../bus.js';
import { routeComment, type CommentContext } from '../routing/router.js';
import { isRoleBusy } from '../runtime/health.js';
import { getSessionForIssue } from '../runtime/health.js';
import { spawnAgent, sendToAgent } from '../runtime/runner.js';
import { enqueue } from '../routing/queue.js';
import { getIssue } from '../linear/client.js';
import chalk from 'chalk';

export function registerCommentHandlers(): void {
  bus.on('webhook:comment.created', async ({ comment, issue }) => {
    // Enrich issue data from Linear if we have an identifier
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
        };
      }
    }

    // Check if there's already an active agent on this issue
    const activeSession = issue.identifier ? getSessionForIssue(issue.identifier) : undefined;

    const ctx: CommentContext = {
      comment,
      issue: enrichedIssue,
      lastActiveAgent: activeSession?.role,
    };

    const decision = routeComment(ctx);

    if (decision.target === 'skip') {
      console.log(chalk.dim(`[comment] ${issue.identifier}: skipped (${decision.reason})`));
      return;
    }

    console.log(chalk.cyan(`[comment] ${issue.identifier} → ${decision.target} (${decision.reason})`));

    // If agent is already running on this issue, pipe the message
    if (activeSession && activeSession.role === decision.target) {
      const sent = sendToAgent(activeSession.tmuxSession, comment.body);
      if (sent) {
        console.log(chalk.green(`[comment] Piped to running ${decision.target}`));
        return;
      }
      // If send failed, session might be dead — fall through to spawn
    }

    // Spawn or queue
    if (isRoleBusy(decision.target)) {
      enqueue({
        issueKey: issue.identifier,
        issueId: issue.id,
        agentRole: decision.target,
        priority: decision.priority,
        context: `Follow-up comment: ${comment.body.substring(0, 500)}`,
      });
    } else {
      spawnAgent({
        role: decision.target,
        issueKey: issue.identifier,
        prompt: `Follow-up from CEO on ${issue.identifier}: ${comment.body}`,
      });
    }
  });
}
