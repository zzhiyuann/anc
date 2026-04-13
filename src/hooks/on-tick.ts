/**
 * Scheduler — runs on system:tick (30s interval).
 * Manages: auto-dispatch, heartbeat triage, stale reconciliation, orphan cleanup.
 */

import { execSync } from 'child_process';
import { bus } from '../bus.js';
import { getRegisteredAgents } from '../agents/registry.js';
import { hasCapacity, getTrackedSessions, getSessionForIssue } from '../runtime/health.js';
import { resolveSession } from '../runtime/resolve.js';
import { sessionExists, getTmuxPath } from '../runtime/runner.js';
import { getIssuesByRole, getUnassignedTodoIssues, getIssuesByStatus, setIssueStatus, getIssue } from '../linear/client.js';
import { routeIssue } from '../routing/router.js';
import { cleanupBreakers } from '../runtime/circuit-breaker.js';
import { getDb } from '../core/db.js';
import { createLogger } from '../core/logger.js';

const log = createLogger('scheduler');

let tickCount = 0;
const HEARTBEAT_EVERY = 10;     // every 10 ticks = 5 min
const MAX_DISPATCHES_PER_TICK = 5;  // dispatch up to 5 per tick

export function registerTickHandlers(): void {
  bus.on('system:tick', async () => {
    tickCount++;

    try {
      await autoDispatchFromBacklog();
    } catch (err) {
      log.error(`autoDispatch error: ${(err as Error).message}`);
    }

    // Every 5 min: periodic maintenance
    if (tickCount % HEARTBEAT_EVERY === 0) {
      try { await heartbeatTriage(); } catch (err) {
        log.error(`heartbeat error: ${(err as Error).message}`);
      }
      try { await reconcileStale(); } catch (err) {
        log.error(`reconcile error: ${(err as Error).message}`);
      }
      try { janitorOrphanTmux(); } catch (err) {
        log.error(`janitor error: ${(err as Error).message}`);
      }
      cleanupBreakers();
      try { detectStuckTasks(); } catch (err) {
        log.error(`stuck-task detection error: ${(err as Error).message}`);
      }
    }
  });
}

/** Detect tasks running > 2x median completion time and emit alerts. */
const stuckAlerted = new Set<string>();

function detectStuckTasks(): void {
  const db = getDb();
  const now = Date.now();

  // Compute median completion time from recently completed sessions (last 30 days).
  const completedRows = db.prepare(
    `SELECT s.spawned_at, e.created_at AS completed_at
     FROM sessions s
     JOIN events e ON e.issue_key = s.issue_key AND e.event_type = 'agent:completed'
     WHERE s.spawned_at > ?`
  ).all(now - 30 * 86400_000) as Array<{ spawned_at: number; completed_at: string }>;

  if (completedRows.length < 3) return; // not enough data

  const durations = completedRows
    .map(r => new Date(r.completed_at).getTime() - r.spawned_at)
    .filter(d => d > 0)
    .sort((a, b) => a - b);

  if (durations.length < 3) return;
  const medianMs = durations[Math.floor(durations.length / 2)];
  const threshold = medianMs * 2;

  // Find active sessions running longer than 2x median.
  const tracked = getTrackedSessions().filter(s => s.state === 'active');
  for (const s of tracked) {
    const elapsed = now - s.spawnedAt;
    if (elapsed <= threshold) continue;
    if (stuckAlerted.has(s.issueKey)) continue;

    stuckAlerted.add(s.issueKey);
    void bus.emit('system:task-stuck', {
      taskId: s.taskId ?? s.issueKey,
      role: s.role,
      issueKey: s.issueKey,
      durationMs: elapsed,
      medianMs,
    });
  }

  // Clean up alerts for sessions that are no longer active.
  const activeKeys = new Set(tracked.map(s => s.issueKey));
  for (const key of stuckAlerted) {
    if (!activeKeys.has(key)) stuckAlerted.delete(key);
  }
}

/** True if we have a usable Linear API key. Treats blank or obvious dummies as missing. */
function hasUsableLinearKey(): boolean {
  const k = process.env.ANC_LINEAR_API_KEY;
  if (!k) return false;
  const lower = k.toLowerCase();
  if (lower === 'dummy' || lower === 'test' || lower === 'fake' || lower.startsWith('dummy')) return false;
  return true;
}

/** Auto-dispatch: pick up Todo issues from Linear (both assigned and unassigned). */
async function autoDispatchFromBacklog(): Promise<void> {
  // Skip cleanly when Linear is not configured (test envs, fresh installs).
  if (!hasUsableLinearKey()) return;
  let dispatched = 0;
  const agents = getRegisteredAgents();

  // Phase 1: Issues assigned to specific agents
  for (const agent of agents) {
    if (dispatched >= MAX_DISPATCHES_PER_TICK) break;
    if (!hasCapacity(agent.role)) continue;
    if (!agent.linearUserId) continue;

    try {
      const todoIssues = await getIssuesByRole(agent.role, 'Todo');
      for (const issue of todoIssues) {
        if (dispatched >= MAX_DISPATCHES_PER_TICK) break;
        if (getSessionForIssue(issue.identifier)) continue;

        const result = resolveSession({ role: agent.role, issueKey: issue.identifier, priority: issue.priority });
        if (result.action === 'spawned' || result.action === 'resumed') {
          log.info(`Auto-dispatched ${agent.role} on ${issue.identifier} (assigned)`, { role: agent.role, issueKey: issue.identifier });
          dispatched++;
        }
      }
    } catch (err) {
      log.error(`assigned dispatch error: ${(err as Error).message}`);
    }
  }

  // Phase 2: Unassigned Todo issues — route them to the right agent
  if (dispatched < MAX_DISPATCHES_PER_TICK) {
    try {
      const unassigned = await getUnassignedTodoIssues();
      log.debug(`Found ${unassigned.length} unassigned Todo issues`);
      for (const issue of unassigned) {
        if (dispatched >= MAX_DISPATCHES_PER_TICK) break;
        if (getSessionForIssue(issue.identifier)) continue;

        // Get full issue details for routing (labels, etc.)
        const full = await getIssue(issue.identifier);
        if (!full) continue;

        const decision = routeIssue({
          id: full.id,
          identifier: full.identifier,
          title: full.title,
          priority: full.priority,
          labels: full.labels,
          project: full.project,
        });

        if (decision.target === 'skip') continue;
        if (!hasCapacity(decision.target)) continue;

        const result = resolveSession({ role: decision.target, issueKey: issue.identifier, priority: issue.priority });
        if (result.action === 'spawned' || result.action === 'resumed') {
          log.info(`Auto-dispatched ${decision.target} on ${issue.identifier} (routed)`, { role: decision.target, issueKey: issue.identifier });
          dispatched++;
        }
      }
    } catch (err) {
      log.error(`unassigned dispatch error: ${(err as Error).message}`);
    }
  }
}

/** Heartbeat: find unassigned Todo issues, dispatch Ops to triage them. */
async function heartbeatTriage(): Promise<void> {
  if (!hasUsableLinearKey()) return;
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

    log.info(`Heartbeat: ${unassigned.length} unassigned issues → Ops`);
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

      log.warn(`Stale: ${issue.identifier} In Progress but no session → Todo`, { issueKey: issue.identifier });
      await setIssueStatus(issue.id, 'Todo');
    }
  } catch {
    // Non-fatal
  }
}

/** Janitor: kill orphan tmux sessions not in our registry. */
function janitorOrphanTmux(): void {
  try {
    const tmux = getTmuxPath();
    const output = execSync(`${tmux} list-sessions -F "#{session_name}" 2>/dev/null`, { encoding: 'utf-8' });
    const ancSessions = output.split('\n').filter(s => s.startsWith('anc-'));
    const tracked = new Set(getTrackedSessions().map(s => s.tmuxSession));

    for (const orphan of ancSessions) {
      if (!tracked.has(orphan)) {
        log.debug(`Killing orphan: ${orphan}`);
        try { execSync(`${tmux} kill-session -t "${orphan}"`, { stdio: 'pipe' }); } catch { /**/ }
      }
    }
  } catch {
    // tmux not running or not found — fine
  }
}
