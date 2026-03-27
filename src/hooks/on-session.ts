/**
 * AgentSession event handler — responds to Linear delegation.
 * Uses resolveSession gate for dedup and lifecycle management.
 */

import { bus } from '../bus.js';
import { getAgentByLinearUserId } from '../agents/registry.js';
import { resolveSession } from '../runtime/resolve.js';
import { getIssue } from '../linear/client.js';
import { getSessionForIssue } from '../runtime/health.js';
import { sendToAgent, sessionExists } from '../runtime/runner.js';
import { createLogger } from '../core/logger.js';

const log = createLogger('session');

export function registerSessionHandlers(): void {
  bus.on('webhook:session.created', async ({ session }) => {
    const agent = getAgentByLinearUserId(session.agentId);
    if (!agent) {
      log.debug(`Unknown agent ID: ${session.agentId}`);
      return;
    }

    const issue = await getIssue(session.issueId);
    if (!issue) {
      log.warn(`Issue not found: ${session.issueId}`);
      return;
    }

    log.info(`Delegation: ${issue.identifier} → ${agent.role}`, { issueKey: issue.identifier, role: agent.role });

    resolveSession({
      role: agent.role,
      issueKey: issue.identifier,
      prompt: session.prompt,
      priority: issue.priority,
      ceoAssigned: true,
    });
  });

  bus.on('webhook:session.prompted', async ({ session, prompt }) => {
    const agent = getAgentByLinearUserId(session.agentId);
    if (!agent) return;

    const issue = await getIssue(session.issueId);
    if (!issue) return;

    // resolveSession handles pipe-to-active, reactivate-idle, resume-suspended, or spawn
    resolveSession({
      role: agent.role,
      issueKey: issue.identifier,
      prompt,
      priority: issue.priority,
      ceoAssigned: true,
    });
  });
}
