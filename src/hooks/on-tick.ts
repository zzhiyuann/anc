/**
 * Scheduler — runs on system:tick (30s interval).
 * Manages: auto-dispatch, heartbeat triage, stale reconciliation, orphan cleanup.
 */

import { execSync } from 'child_process';
import { bus } from '../bus.js';
import { getRegisteredAgents } from '../agents/registry.js';
import { hasCapacity, getTrackedSessions, getSessionForIssue } from '../runtime/health.js';
import { resolveSession, sessionExists } from '../runtime/runner.js';
import { getIssuesByRole, getUnassignedTodoIssues, getIssuesByStatus, setIssueStatus } from '../linear/client.js';
import { cleanupBreakers } from '../runtime/circuit-breaker.js';
import chalk from 'chalk';

let tickCount = 0;
const HEARTBEAT_EVERY = 10;     // every 10 ticks = 5 min
const MAX_DISPATCHES_PER_TICK = 2;  // prevent burst

export function registerTickHandlers(): void {
  bus.on('system:tick', async () => {
    tickCount++;

    try {
      // Every tick: auto-dispatch from backlog
      await autoDispatchFromBacklog();
    } catch (err) {
      console.error(chalk.dim(`[scheduler] autoDispatch error: ${(err as Error).message}`));
    }

    // Every 5 min: periodic maintenance
    if (tickCount % HEARTBEAT_EVERY === 0) {
      try { await heartbeatTriage(); } catch (err) {
        console.error(chalk.dim(`[scheduler] heartbeat error: ${(err as Error).message}`));
      }
      try { await reconcileStale(); } catch (err) {
        console.error(chalk.dim(`[scheduler] reconcile error: ${(err as Error).message}`));
      }
      try { janitorOrphanTmux(); } catch (err) {
        console.error(chalk.dim(`[scheduler] janitor error: ${(err as Error).message}`));
      }
      cleanupBreakers();
    }
  });
}

/** Auto-dispatch: for each role with capacity, pick up assigned Todo issues from Linear. */
async function autoDispatchFromBacklog(): Promise<void> {
  const agents = getRegisteredAgents();
  let dispatched = 0;

  for (const agent of agents) {
    if (dispatched >= MAX_DISPATCHES_PER_TICK) break;
    if (!hasCapacity(agent.role)) continue;
    if (!agent.linearUserId) continue;  // no Linear identity → can't query assigned issues

    try {
      const todoIssues = await getIssuesByRole(agent.role, 'Todo');
      for (const issue of todoIssues) {
        if (dispatched >= MAX_DISPATCHES_PER_TICK) break;
        if (getSessionForIssue(issue.identifier)) continue;  // already tracked

        const result = resolveSession({
          role: agent.role,
          issueKey: issue.identifier,
          priority: issue.priority,
        });

        if (result.action === 'spawned' || result.action === 'resumed') {
          console.log(chalk.cyan(`[scheduler] Auto-dispatched ${agent.role} on ${issue.identifier}`));
          dispatched++;
        }
      }
    } catch {
      // Linear API might fail — non-fatal
    }
  }
}

/** Heartbeat: find unassigned Todo issues, dispatch Ops to triage them. */
async function heartbeatTriage(): Promise<void> {
  if (!hasCapacity('ops')) return;

  try {
    const unassigned = await getUnassignedTodoIssues();
    if (unassigned.length === 0) return;

    const issueList = unassigned.slice(0, 10).map(i => `- ${i.identifier}: ${i.title}`).join('\n');

    resolveSession({
      role: 'ops',
      issueKey: unassigned[0].identifier,
      prompt: `[Heartbeat Triage] Unassigned issues in Todo:\n${issueList}\n\nReview and assign each to the right agent.`,
      priority: 4,
    });

    console.log(chalk.cyan(`[scheduler] Heartbeat: ${unassigned.length} unassigned issues → Ops`));
  } catch {
    // Linear API might fail — non-fatal
  }
}

/** Reconcile: In Progress issues with no tracked session → back to Todo. */
async function reconcileStale(): Promise<void> {
  try {
    const inProgress = await getIssuesByStatus('In Progress');
    const tracked = new Set(getTrackedSessions().map(s => s.issueKey));

    for (const issue of inProgress) {
      if (tracked.has(issue.identifier)) continue;

      // Safety: don't reconcile very recent issues (may be in spawn pipeline)
      const created = new Date(issue.url).getTime();  // fallback — ideally check createdAt
      if (Date.now() - created < 10 * 60_000) continue;  // < 10 min old

      console.log(chalk.yellow(`[scheduler] Stale: ${issue.identifier} In Progress but no session → Todo`));
      await setIssueStatus(issue.id, 'Todo');
    }
  } catch {
    // Non-fatal
  }
}

/** Janitor: kill orphan tmux sessions not in our registry. */
function janitorOrphanTmux(): void {
  try {
    const output = execSync('tmux list-sessions -F "#{session_name}" 2>/dev/null', { encoding: 'utf-8' });
    const ancSessions = output.split('\n').filter(s => s.startsWith('anc-'));
    const tracked = new Set(getTrackedSessions().map(s => s.tmuxSession));

    for (const orphan of ancSessions) {
      if (!tracked.has(orphan)) {
        console.log(chalk.dim(`[janitor] Killing orphan: ${orphan}`));
        try { execSync(`tmux kill-session -t "${orphan}"`, { stdio: 'pipe' }); } catch { /**/ }
      }
    }
  } catch {
    // tmux not running — fine
  }
}
