/**
 * AgentSession event handler — responds to Linear delegation.
 * Uses resolveSession gate for dedup and lifecycle management.
 */

import { bus } from '../bus.js';
import { getAgentByLinearUserId } from '../agents/registry.js';
import { resolveSession } from '../runtime/runner.js';
import { getIssue } from '../linear/client.js';
import { getSessionForIssue } from '../runtime/health.js';
import { sendToAgent, sessionExists } from '../runtime/runner.js';
import chalk from 'chalk';

export function registerSessionHandlers(): void {
  bus.on('webhook:session.created', async ({ session }) => {
    const agent = getAgentByLinearUserId(session.agentId);
    if (!agent) {
      console.log(chalk.dim(`[session] Unknown agent ID: ${session.agentId}`));
      return;
    }

    const issue = await getIssue(session.issueId);
    if (!issue) {
      console.log(chalk.dim(`[session] Issue not found: ${session.issueId}`));
      return;
    }

    console.log(chalk.cyan(`[session] Delegation: ${issue.identifier} → ${agent.role}`));

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
