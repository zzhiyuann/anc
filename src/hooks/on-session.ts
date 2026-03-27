/**
 * AgentSession event handler — responds to Linear delegation.
 * Uses resolveSession gate for dedup and lifecycle management.
 */

import { bus } from '../bus.js';
import { getAgentByLinearUserId } from '../agents/registry.js';
import { resolveSession } from '../runtime/resolve.js';
import { getIssue, dismissSession, emitActivity } from '../linear/client.js';
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

    // Immediately acknowledge the session to prevent "Did not respond" timeout (~12s)
    const acked = await emitActivity(session.id, 'Working on it...', 'thought', true, agent.role);
    if (acked) {
      log.debug(`Acknowledged session ${session.id} for ${agent.role}`);
    } else {
      log.warn(`Failed to acknowledge session ${session.id}`);
    }

    const issue = await getIssue(session.issueId);
    if (!issue) {
      log.warn(`Issue not found: ${session.issueId}`);
      await dismissSession(session.id, agent.role).catch(() => {});
      return;
    }

    log.info(`Delegation: ${issue.identifier} → ${agent.role}`, { issueKey: issue.identifier, role: agent.role });

    // Check if agent is already working on this issue
    const existing = getSessionForIssue(issue.identifier);
    if (existing?.state === 'active') {
      log.debug(`Agent already active on ${issue.identifier}, dismissing session ${session.id}`);
      await dismissSession(session.id, agent.role);
      return;
    }

    // Spawn agent — store session ID so lifecycle can dismiss it when done
    const result = resolveSession({
      role: agent.role,
      issueKey: issue.identifier,
      prompt: session.prompt,
      priority: issue.priority,
      ceoAssigned: true,
    });

    // Track the Linear session ID for later dismissal
    const tracked = getSessionForIssue(issue.identifier);
    if (tracked) {
      tracked.linearSessionId = session.id;
    }
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
