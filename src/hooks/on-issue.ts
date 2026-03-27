/**
 * Issue event handlers — route new issues through resolveSession.
 */

import { bus } from '../bus.js';
import { routeIssue } from '../routing/router.js';
import { resolveSession } from '../runtime/runner.js';
import { hasCapacity } from '../runtime/health.js';
import { dequeue, completeItem } from '../routing/queue.js';
import { createLogger } from '../core/logger.js';

const log = createLogger('issue');

export function registerIssueHandlers(): void {
  bus.on('webhook:issue.created', async ({ issue }) => {
    const status = (typeof issue.state === 'string' ? issue.state : '').toLowerCase();
    if (status === 'backlog' || status === 'canceled' || status === 'done') return;

    const decision = routeIssue(issue);
    if (decision.target === 'skip') return;

    log.info(`${issue.identifier} → ${decision.target} (${decision.reason})`, { issueKey: issue.identifier });
    resolveSession({ role: decision.target, issueKey: issue.identifier, priority: decision.priority });
  });

  // Queue drain on lifecycle events
  bus.on('agent:completed', async ({ role }) => drainQueueForRole(role));
  bus.on('agent:suspended', async ({ role }) => drainQueueForRole(role));
  bus.on('agent:idle', async ({ role }) => drainQueueForRole(role));
}

function drainQueueForRole(role: string): void {
  while (hasCapacity(role)) {
    const next = dequeue(role);
    if (!next) break;
    log.info(`queue drain: ${next.issueKey} → ${role}`, { issueKey: next.issueKey, role });
    resolveSession({ role, issueKey: next.issueKey, prompt: next.context ?? undefined, priority: next.priority });
    completeItem(next.id);
  }
}
