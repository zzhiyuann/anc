/**
 * AgentSession event handler — responds to Linear delegation.
 * When CEO delegates an issue to an agent in Linear, this triggers the spawn.
 */

import { bus } from '../bus.js';
import { getAgentByLinearUserId } from '../agents/registry.js';
import { isRoleBusy } from '../runtime/health.js';
import { spawnAgent, sendToAgent } from '../runtime/runner.js';
import { getSessionForIssue } from '../runtime/health.js';
import { enqueue } from '../routing/queue.js';
import { getIssue } from '../linear/client.js';
import chalk from 'chalk';

export function registerSessionHandlers(): void {
  // Agent delegation — CEO assigns issue to an agent in Linear
  bus.on('webhook:session.created', async ({ session }) => {
    const agent = getAgentByLinearUserId(session.agentId);
    if (!agent) {
      console.log(chalk.dim(`[session] Unknown agent ID: ${session.agentId}`));
      return;
    }

    // Get issue details
    const issue = await getIssue(session.issueId);
    if (!issue) {
      console.log(chalk.dim(`[session] Issue not found: ${session.issueId}`));
      return;
    }

    console.log(chalk.cyan(`[session] Delegation: ${issue.identifier} → ${agent.role}`));

    // Check if already working on this issue
    const existing = getSessionForIssue(issue.identifier);
    if (existing && existing.role === agent.role) {
      console.log(chalk.dim(`[session] Already working: ${agent.role} on ${issue.identifier}`));
      return;
    }

    if (isRoleBusy(agent.role)) {
      enqueue({
        issueKey: issue.identifier,
        issueId: issue.id,
        agentRole: agent.role,
        priority: issue.priority,
        context: session.prompt,
      });
    } else {
      spawnAgent({
        role: agent.role,
        issueKey: issue.identifier,
        prompt: session.prompt,
      });
    }
  });

  // Prompted — CEO sends a follow-up message through the session UI
  bus.on('webhook:session.prompted', async ({ session, prompt }) => {
    const agent = getAgentByLinearUserId(session.agentId);
    if (!agent) return;

    const issue = await getIssue(session.issueId);
    if (!issue) return;

    // Try to pipe to running session
    const existing = getSessionForIssue(issue.identifier);
    if (existing) {
      const sent = sendToAgent(existing.tmuxSession, prompt);
      if (sent) {
        console.log(chalk.green(`[session] Piped prompt to ${agent.role} on ${issue.identifier}`));
        return;
      }
    }

    // Session not running — spawn fresh
    spawnAgent({
      role: agent.role,
      issueKey: issue.identifier,
      prompt,
    });
  });
}
