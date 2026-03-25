/**
 * Issue event handlers — respond to issue creation/update.
 */

import { bus } from '../bus.js';
import { routeIssue } from '../routing/router.js';
import { enqueue } from '../routing/queue.js';
import { isRoleBusy } from '../runtime/health.js';
import { spawnAgent } from '../runtime/runner.js';
import { dequeue, completeItem } from '../routing/queue.js';
import chalk from 'chalk';

export function registerIssueHandlers(): void {
  bus.on('webhook:issue.created', async ({ issue }) => {
    // Only route issues in Todo or higher status
    const status = issue.state?.toLowerCase() ?? '';
    if (status === 'backlog' || status === 'canceled' || status === 'done') return;

    const decision = routeIssue(issue);
    if (decision.target === 'skip') return;

    console.log(chalk.cyan(`[issue] ${issue.identifier} → ${decision.target} (${decision.reason})`));

    // If agent is busy, queue. Otherwise spawn immediately.
    if (isRoleBusy(decision.target)) {
      enqueue({
        issueKey: issue.identifier,
        issueId: issue.id,
        agentRole: decision.target,
        priority: decision.priority,
      });
    } else {
      spawnAgent({ role: decision.target, issueKey: issue.identifier });
    }
  });

  // Queue drain: when an agent completes, check if there's queued work
  bus.on('agent:completed', async ({ role }) => {
    const next = dequeue(role);
    if (next) {
      console.log(chalk.cyan(`[queue] Draining: ${next.issueKey} → ${role}`));
      spawnAgent({ role, issueKey: next.issueKey, prompt: next.context ?? undefined });
      completeItem(next.id);
    }
  });
}
