/**
 * Company mode — fleet-level commands.
 *   anc company start  — spawn all agents on their Todo backlog
 *   anc company stop   — graceful shutdown all active sessions
 *   anc company status — fleet overview
 */

import chalk from 'chalk';
import { getRegisteredAgents } from '../agents/registry.js';
import { getHealthStatus, getActiveSessions, getTrackedSessions } from '../runtime/health.js';
import { resolveSession } from '../runtime/resolve.js';
import { killAgent } from '../runtime/runner.js';
import { getIssuesByRole } from '../linear/client.js';
import { createLogger } from '../core/logger.js';

const log = createLogger('company');

/** Start all agents — each picks up their assigned Todo issues. */
export async function companyStart(): Promise<void> {
  const agents = getRegisteredAgents();
  console.log(chalk.bold('\nStarting company...\n'));

  let totalDispatched = 0;

  for (const agent of agents) {
    if (!agent.linearUserId) {
      console.log(chalk.dim(`  ${agent.role}: no Linear identity, skipping`));
      continue;
    }

    try {
      const todoIssues = await getIssuesByRole(agent.role, 'Todo');
      if (todoIssues.length === 0) {
        console.log(chalk.dim(`  ${agent.role}: no Todo issues`));
        continue;
      }

      let dispatched = 0;
      for (const issue of todoIssues) {
        const result = resolveSession({
          role: agent.role,
          issueKey: issue.identifier,
          priority: issue.priority,
        });
        if (result.action === 'spawned' || result.action === 'resumed') {
          dispatched++;
          totalDispatched++;
        }
      }

      console.log(chalk.green(`  ${agent.role}: dispatched ${dispatched}/${todoIssues.length} issues`));
    } catch (err) {
      console.log(chalk.red(`  ${agent.role}: error — ${(err as Error).message}`));
    }
  }

  console.log(chalk.bold(`\nCompany started: ${totalDispatched} agents dispatched.\n`));
  log.info(`Company started: ${totalDispatched} agents dispatched`);
}

/** Stop all active sessions gracefully. */
export function companyStop(): void {
  const agents = getRegisteredAgents();
  console.log(chalk.bold('\nStopping company...\n'));

  let totalStopped = 0;

  for (const agent of agents) {
    const active = getActiveSessions(agent.role);
    for (const session of active) {
      killAgent(session.tmuxSession);
      totalStopped++;
    }
    if (active.length > 0) {
      console.log(chalk.yellow(`  ${agent.role}: stopped ${active.length} sessions`));
    }
  }

  if (totalStopped === 0) {
    console.log(chalk.dim('  No active sessions to stop.'));
  } else {
    console.log(chalk.bold(`\nCompany stopped: ${totalStopped} sessions terminated.\n`));
  }
  log.info(`Company stopped: ${totalStopped} sessions terminated`);
}

/** Fleet overview — all agents, sessions, capacity. */
export function companyStatus(): void {
  const agents = getRegisteredAgents();
  const allSessions = getTrackedSessions();

  console.log(chalk.bold('\nANC Company Status\n'));

  const totalActive = allSessions.filter(s => s.state === 'active').length;
  const totalIdle = allSessions.filter(s => s.state === 'idle').length;
  const totalSuspended = allSessions.filter(s => s.state === 'suspended').length;

  console.log(`  Total sessions: ${totalActive} active, ${totalIdle} idle, ${totalSuspended} suspended`);
  console.log('');

  for (const agent of agents) {
    const h = getHealthStatus(agent.role);
    const capacityPct = Math.round((h.activeSessions / h.maxConcurrency) * 100);
    const bar = capacityPct >= 80 ? chalk.red(`${capacityPct}%`) : capacityPct >= 50 ? chalk.yellow(`${capacityPct}%`) : chalk.green(`${capacityPct}%`);

    console.log(`  ${chalk.bold(agent.name)} (${agent.role}) — ${h.activeSessions}/${h.maxConcurrency} active [${bar}], ${h.idleSessions} idle, ${h.suspendedSessions} suspended`);

    for (const s of h.sessions) {
      const icon = s.state === 'active' ? chalk.green('●') : s.state === 'idle' ? chalk.blue('○') : chalk.yellow('◐');
      const uptime = s.uptime ? ` (${Math.round(s.uptime / 60)}m)` : '';
      console.log(`    ${icon} ${s.issueKey} [${s.state}]${uptime}`);
    }
  }

  console.log('');
}
