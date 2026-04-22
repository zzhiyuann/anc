/**
 * Session resolution gate — ALL trigger paths converge here.
 * Handles dedup, reactivation, resume, spawn, capacity, circuit breaker.
 */

import { readFileSync, existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import type { AgentRole } from '../linear/types.js';
import { createLogger } from '../core/logger.js';
import { getWorkspacePath } from './workspace.js';
import { bus } from '../bus.js';
import {
  untrackSession, markActiveFromIdle,
  markSuspended, markResumed, hasCapacity, hasDutyCapacity, pickToEvict,
  getSessionForIssue,
} from './health.js';
import { isBreakerTripped, recordFailure, recordSuccess } from './circuit-breaker.js';
import { enqueue, isInCooldown } from '../routing/queue.js';
import { spawnClaude, suspendSession, sessionExists, sendToAgent } from './runner.js';
import { canSpend, estimateCost } from '../core/budget.js';
import { isGlobalPaused } from '../core/kill-switch.js';
import { setTaskState, getTask } from '../core/tasks.js';

const log = createLogger('resolve');

// --- Dedup / Rate-limit ---

const DEDUP_WINDOW_MS = 60_000;
const recentlyHandled = new Map<string, number>();

/** Returns true if this key was seen within the dedup window. */
export function shouldDedup(key: string): boolean {
  const last = recentlyHandled.get(key);
  if (last && Date.now() - last < DEDUP_WINDOW_MS) return true;
  recentlyHandled.set(key, Date.now());
  // Prune old entries when map grows
  if (recentlyHandled.size > 200) {
    const cutoff = Date.now() - DEDUP_WINDOW_MS * 5;
    for (const [k, v] of recentlyHandled) {
      if (v < cutoff) recentlyHandled.delete(k);
    }
  }
  return false;
}

/** Reset dedup state (for testing) */
export function _resetDedup(): void {
  recentlyHandled.clear();
}

// --- Artifact cleanup ---

const STALE_ARTIFACTS = ['HANDOFF.md', 'BLOCKED.md', 'PROGRESS.md', 'SUSPEND.md'];

/** Remove stale lifecycle artifacts from a workspace before a fresh spawn. */
function cleanStaleArtifacts(issueKey: string): void {
  const workspace = getWorkspacePath(issueKey);
  for (const file of STALE_ARTIFACTS) {
    const p = join(workspace, file);
    if (existsSync(p)) {
      try { unlinkSync(p); } catch { /**/ }
      log.debug(`Cleaned stale ${file} from ${issueKey}`, { issueKey });
    }
  }
}

// --- Public types ---

export interface ResolveResult {
  action: 'piped' | 'resumed' | 'spawned' | 'queued' | 'blocked' | 'deduped';
  tmuxSession?: string;
  error?: string;
}

// --- Task state helper ---

/** Set task to "running" if it exists and is in a state that allows the transition. */
function setTaskRunning(taskId: string | undefined): void {
  if (!taskId) return;
  try {
    const task = getTask(taskId);
    if (task && (task.state === 'todo' || task.state === 'suspended')) {
      setTaskState(taskId, 'running');
      log.debug(`Task ${taskId}: state → running`, { taskId });
    }
  } catch (err) {
    log.warn(`Failed to set task running: ${(err as Error).message}`, { taskId });
  }
}

// --- The Universal Gate ---

/**
 * resolveSession — ALL trigger paths converge here.
 * Handles dedup, reactivation, resume, spawn, capacity, circuit breaker.
 */
export function resolveSession(opts: {
  role: AgentRole;
  issueKey: string;
  prompt?: string;
  priority?: number;
  ceoAssigned?: boolean;
  isDuty?: boolean;
  taskId?: string;
}): ResolveResult {
  const { role, issueKey, prompt, priority, ceoAssigned, isDuty, taskId } = opts;

  // 0a. Dedup — reject duplicate dispatch within 60s window
  const dedupKey = `resolve:${issueKey}`;
  if (shouldDedup(dedupKey)) {
    log.debug(`${issueKey}: deduped (within ${DEDUP_WINDOW_MS / 1000}s window)`, { issueKey });
    return { action: 'deduped', error: `duplicate within ${DEDUP_WINDOW_MS / 1000}s` };
  }

  // 0b. Per-task cooldown — prevents rapid-fire re-dispatch after completion
  if (isInCooldown(issueKey)) {
    log.debug(`${issueKey}: in cooldown, refusing spawn`, { issueKey });
    return { action: 'blocked', error: 'task cooldown active' };
  }

  // 0c. Global kill switch — refuse to spawn anything while paused.
  if (isGlobalPaused()) {
    log.warn(`${issueKey}: kill-switch engaged, refusing to spawn`, { issueKey });
    return { action: 'blocked', error: 'kill-switch engaged' };
  }

  // 1. Circuit breaker
  const tripped = isBreakerTripped(issueKey);
  if (tripped > 0) {
    log.debug(`${issueKey}: breaker tripped (${Math.round(tripped / 1000)}s remaining)`, { issueKey });
    return { action: 'blocked', error: `circuit breaker: ${Math.round(tripped / 1000)}s` };
  }

  const existing = getSessionForIssue(issueKey);

  // 2. ACTIVE session → pipe message to it
  if (existing?.state === 'active' && sessionExists(existing.tmuxSession)) {
    if (prompt) sendToAgent(existing.tmuxSession, prompt);
    setTaskRunning(taskId);
    return { action: 'piped', tmuxSession: existing.tmuxSession };
  }

  // 3. IDLE session → reactivate with --continue
  if (existing?.state === 'idle') {
    const tmux = `anc-${role}-${issueKey}`;
    const result = spawnClaude({ role, issueKey, prompt, useContinue: true, ceoAssigned, priority, taskId });
    if (result.success) {
      markActiveFromIdle(issueKey, tmux);
      setTaskRunning(taskId);
      bus.emit('agent:resumed', { role, issueKey, tmuxSession: tmux });
      recordSuccess(issueKey);
      return { action: 'resumed', tmuxSession: tmux };
    }
    recordFailure(issueKey);
    return { action: 'blocked', error: result.error };
  }

  // 4. SUSPENDED session → resume with --continue + SUSPEND.md context
  if (existing?.state === 'suspended') {
    const workspace = getWorkspacePath(issueKey);
    const suspendPath = join(workspace, 'SUSPEND.md');
    let resumePrompt = prompt ?? '';
    if (existsSync(suspendPath)) {
      const checkpoint = readFileSync(suspendPath, 'utf-8');
      resumePrompt = `You are RESUMING work on ${issueKey}.\n\nCheckpoint:\n${checkpoint}\n\n${resumePrompt}`;
      try { unlinkSync(suspendPath); } catch { /**/ }  // clean up after reading
    }
    const tmux = `anc-${role}-${issueKey}`;
    const result = spawnClaude({ role, issueKey, prompt: resumePrompt, useContinue: true, ceoAssigned, priority, taskId });
    if (result.success) {
      markResumed(issueKey, tmux);
      setTaskRunning(taskId);
      bus.emit('agent:resumed', { role, issueKey, tmuxSession: tmux });
      recordSuccess(issueKey);
      return { action: 'resumed', tmuxSession: tmux };
    }
    recordFailure(issueKey);
    return { action: 'blocked', error: result.error };
  }

  // 5. No session → need to spawn fresh
  //    Clean stale artifacts from previous attempts first
  cleanStaleArtifacts(issueKey);
  //    Duty sessions use separate pool; task sessions use main pool
  const poolHasRoom = isDuty ? hasDutyCapacity(role) : hasCapacity(role);
  if (!poolHasRoom) {
    const victim = pickToEvict(role);
    if (victim) {
      if (victim.state === 'idle') {
        // Idle sessions: just untrack (workspace preserved, --continue still works later)
        log.debug(`Evicting idle ${victim.role}/${victim.issueKey}`, { role: victim.role, issueKey: victim.issueKey });
        untrackSession(victim.issueKey);
      } else {
        // Active session: needs suspend protocol
        log.warn(`Suspending ${victim.role}/${victim.issueKey} for ${issueKey}`, { role: victim.role, issueKey });
        suspendSession(victim.issueKey);
      }
    } else {
      // All sessions protected — queue
      enqueue({ issueKey, issueId: '', agentRole: role, priority: priority ?? 3, context: prompt });
      return { action: 'queued' };
    }
  }

  // Budget gate — only for fresh spawns. Resume/reactivate/pipe paths already skipped above.
  const estimate = estimateCost(role);
  const budgetCheck = canSpend(role, estimate);
  if (!budgetCheck.allowed) {
    log.warn(`Budget blocked spawn for ${role}/${issueKey}: ${budgetCheck.reason}`, { role, issueKey });
    return { action: 'blocked', error: budgetCheck.reason };
  }

  // Spawn — auto-detect if workspace has prior conversation (use --continue for free context recovery)
  // Only use --continue if persona CLAUDE.md exists (not just .claude/ dir from settings)
  const hasPersona = existsSync(join(getWorkspacePath(issueKey), '.claude', 'CLAUDE.md'));
  const result = spawnClaude({ role, issueKey, prompt, useContinue: hasPersona, ceoAssigned, priority, isDuty, taskId });
  if (result.success) {
    setTaskRunning(taskId);
    recordSuccess(issueKey);
    return { action: 'spawned', tmuxSession: result.tmuxSession };
  }

  recordFailure(issueKey);
  return { action: 'blocked', error: result.error };
}
