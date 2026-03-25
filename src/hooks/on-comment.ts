/**
 * Comment event handler — routes CEO messages to the right agent.
 * Concurrency-aware: resumes suspended sessions, pipes to active ones.
 */

import { bus } from '../bus.js';
import { routeComment, type CommentContext } from '../routing/router.js';
import { hasCapacity, getSessionForIssue, isIssueSuspended, isIssueActive } from '../runtime/health.js';
import { spawnAgent, sendToAgent, resumeSession } from '../runtime/runner.js';
import { enqueue } from '../routing/queue.js';
import { getIssue } from '../linear/client.js';
import chalk from 'chalk';

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
        };
      }
    }

    // Get current session state for this issue
    const session = issue.identifier ? getSessionForIssue(issue.identifier) : undefined;

    const ctx: CommentContext = {
      comment,
      issue: enrichedIssue,
      lastActiveAgent: session?.role,
    };

    const decision = routeComment(ctx);

    if (decision.target === 'skip') {
      console.log(chalk.dim(`[comment] ${issue.identifier}: skipped (${decision.reason})`));
      return;
    }

    console.log(chalk.cyan(`[comment] ${issue.identifier} → ${decision.target} (${decision.reason})`));

    // CASE 1: Issue has an ACTIVE session for the target role → pipe message
    if (session && session.role === decision.target && session.state === 'active') {
      const sent = sendToAgent(session.tmuxSession, comment.body);
      if (sent) {
        console.log(chalk.green(`[comment] Piped to active ${decision.target}/${issue.identifier}`));
        return;
      }
      // Send failed — session might be dead, fall through
    }

    // CASE 2: Issue has a SUSPENDED session → resume with the new comment as context
    if (isIssueSuspended(issue.identifier)) {
      console.log(chalk.green(`[comment] Resuming suspended ${decision.target}/${issue.identifier}`));
      resumeSession(issue.identifier, `Follow-up from CEO: ${comment.body}`);
      return;
    }

    // CASE 3: No existing session — spawn new (or queue if at capacity)
    if (hasCapacity(decision.target)) {
      spawnAgent({
        role: decision.target,
        issueKey: issue.identifier,
        prompt: `Follow-up from CEO on ${issue.identifier}: ${comment.body}`,
        priority: decision.priority,
      });
    } else {
      // spawnAgent handles auto-suspend internally — try it
      const result = spawnAgent({
        role: decision.target,
        issueKey: issue.identifier,
        prompt: `Follow-up from CEO on ${issue.identifier}: ${comment.body}`,
        priority: decision.priority,
      });
      if (!result.success) {
        enqueue({
          issueKey: issue.identifier,
          issueId: issue.id,
          agentRole: decision.target,
          priority: decision.priority,
          context: `Follow-up comment: ${comment.body.substring(0, 500)}`,
        });
      }
    }
  });
}
