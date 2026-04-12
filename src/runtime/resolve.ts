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
import { enqueue } from '../routing/queue.js';
import { spawnClaude, suspendSession, sessionExists, sendToAgent } from './runner.js';
import { canSpend, estimateCost } from '../core/budget.js';

const log = createLogger('resolve');

// --- Public types ---

export interface ResolveResult {
  action: 'piped' | 'resumed' | 'spawned' | 'queued' | 'blocked';
  tmuxSession?: string;
  error?: string;
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
}): ResolveResult {
  const { role, issueKey, prompt, priority, ceoAssigned, isDuty } = opts;

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
    return { action: 'piped', tmuxSession: existing.tmuxSession };
  }

  // 3. IDLE session → reactivate with --continue
  if (existing?.state === 'idle') {
    const tmux = `anc-${role}-${issueKey}`;
    const result = spawnClaude({ role, issueKey, prompt, useContinue: true, ceoAssigned, priority });
    if (result.success) {
      markActiveFromIdle(issueKey, tmux);
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
    const result = spawnClaude({ role, issueKey, prompt: resumePrompt, useContinue: true, ceoAssigned, priority });
    if (result.success) {
      markResumed(issueKey, tmux);
      bus.emit('agent:resumed', { role, issueKey, tmuxSession: tmux });
      recordSuccess(issueKey);
      return { action: 'resumed', tmuxSession: tmux };
    }
    recordFailure(issueKey);
    return { action: 'blocked', error: result.error };
  }

  // 5. No session → need to spawn fresh
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
  const workspaceExists = existsSync(join(getWorkspacePath(issueKey), '.claude'));
  const result = spawnClaude({ role, issueKey, prompt, useContinue: workspaceExists, ceoAssigned, priority, isDuty });
  if (result.success) {
    recordSuccess(issueKey);
    return { action: 'spawned', tmuxSession: result.tmuxSession };
  }

  recordFailure(issueKey);
  return { action: 'blocked', error: result.error };
}
