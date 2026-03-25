/**
 * Issue event handlers — respond to issue creation/update.
 * Concurrency-aware: spawns up to maxConcurrency, then queues.
 */

import { bus } from '../bus.js';
import { routeIssue } from '../routing/router.js';
import { enqueue } from '../routing/queue.js';
import { hasCapacity } from '../runtime/health.js';
import { spawnAgent, resumeSession } from '../runtime/runner.js';
import { dequeue, completeItem } from '../routing/queue.js';
import { isIssueSuspended } from '../runtime/health.js';
import chalk from 'chalk';

export function registerIssueHandlers(): void {
  bus.on('webhook:issue.created', async ({ issue }) => {
    const status = issue.state?.toLowerCase() ?? '';
    if (status === 'backlog' || status === 'canceled' || status === 'done') return;

    const decision = routeIssue(issue);
    if (decision.target === 'skip') return;

    console.log(chalk.cyan(`[issue] ${issue.identifier} → ${decision.target} (${decision.reason})`));

    // Spawn if we have capacity (concurrency limit not reached)
    if (hasCapacity(decision.target)) {
      spawnAgent({
        role: decision.target,
        issueKey: issue.identifier,
        priority: decision.priority,
      });
    } else {
      // At capacity — queue (spawnAgent will auto-suspend if needed,
      // but only if there's a suspendable session. If all are protected, queue.)
      enqueue({
        issueKey: issue.identifier,
        issueId: issue.id,
        agentRole: decision.target,
        priority: decision.priority,
      });
    }
  });

  // Queue drain: when an agent completes or is suspended, check for queued work
  bus.on('agent:completed', async ({ role }) => {
    drainQueueForRole(role);
  });

  // Also drain when a session is suspended (frees a slot)
  bus.on('agent:suspended', async ({ role }) => {
    drainQueueForRole(role);
  });
}

function drainQueueForRole(role: string): void {
  // Keep draining while there's capacity and queued items
  while (hasCapacity(role)) {
    const next = dequeue(role);
    if (!next) break;

    console.log(chalk.cyan(`[queue] Draining: ${next.issueKey} → ${role}`));

    // Check if this issue was previously suspended — resume instead of fresh spawn
    if (isIssueSuspended(next.issueKey)) {
      resumeSession(next.issueKey, next.context ?? undefined);
    } else {
      spawnAgent({ role, issueKey: next.issueKey, prompt: next.context ?? undefined, priority: next.priority });
    }
    completeItem(next.id);
  }
}
