/**
 * Completion handler — detects HANDOFF.md/SUSPEND.md on dead sessions.
 *
 * In the hybrid model, claude exits after each -p prompt.
 * Dead tmux is NORMAL (not always a failure). Detection:
 *
 *   tmux dead + HANDOFF.md → formal completion (quality gates, status transition)
 *   tmux dead + SUSPEND.md → suspended (capacity eviction)
 *   tmux dead + nothing    → lightweight completion (conversation ended, mark idle)
 *   tmux alive             → still working, skip
 *
 * NOTE: Interactive-mode completion is now ALSO handled by hook-handler.ts
 * via the Stop hook + handoff-processor.ts. This file handles the legacy
 * "tmux died" detection path. Both paths call the shared processHandoff().
 */

import { existsSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { bus } from '../bus.js';
import {
  getTrackedSessions, markIdle, markSuspended,
} from '../runtime/health.js';
import { getWorkspacePath } from '../runtime/workspace.js';
import { addComment } from '../linear/client.js';
import { sessionExists } from '../runtime/runner.js';
import { createLogger } from '../core/logger.js';
import { recordSpend, estimateCost } from '../core/budget.js';
import { resolveTaskIdFromIssueKey, setTaskState, addTaskComment, updateTask } from '../core/tasks.js';
import { createNotification } from '../core/notifications.js';
import { processHandoff } from './handoff-processor.js';

const log = createLogger('complete');

// Re-export detectTaskType for backward compatibility (tests, etc.)
export { detectTaskType } from './handoff-processor.js';

/** Track last PROGRESS.md check time per issue to avoid re-reading unchanged files. */
const progressLastChecked = new Map<string, number>();

/**
 * Heuristic cost estimator from elapsed runtime.
 * Falls back to $0.10/minute active, clamped to per-role floor.
 */
function estimateCostFromElapsed(role: string, spawnedAt: number): number {
  const elapsedMinutes = Math.max(0, (Date.now() - spawnedAt) / 60_000);
  const timeBased = elapsedMinutes * 0.10;
  return Math.max(timeBased, estimateCost(role));
}

// --- Main tick handler ---

export function registerCompletionHandlers(): void {
  bus.on('system:tick', async () => {
    const sessions = getTrackedSessions();

    for (const session of sessions) {
      if (session.state !== 'active') continue;

      const workspace = getWorkspacePath(session.issueKey);
      const handoffPath = join(workspace, 'HANDOFF.md');
      const suspendPath = join(workspace, 'SUSPEND.md');
      const blockedPath = join(workspace, 'BLOCKED.md');
      const alive = sessionExists(session.tmuxSession);

      // PROGRESS.md detection — read progress from alive sessions
      if (alive) {
        const progressPath = join(workspace, 'PROGRESS.md');
        if (existsSync(progressPath)) {
          try {
            const mtime = statSync(progressPath).mtimeMs;
            const lastCheck = progressLastChecked.get(session.issueKey) ?? 0;
            if (mtime > lastCheck) {
              progressLastChecked.set(session.issueKey, Date.now());
              const content = readFileSync(progressPath, 'utf-8').trim();
              if (content.length > 0) {
                const progressTaskId = resolveTaskIdFromIssueKey(session.issueKey);
                if (progressTaskId) {
                  updateTask(progressTaskId, { handoffSummary: content.substring(0, 2000) });
                  bus.emit('task:progress', { taskId: progressTaskId, content: content.substring(0, 2000) });
                }
              }
            }
          } catch { /**/ }
        }
        continue;
      }

      // --- tmux is dead. Determine what happened. ---

      // HANDOFF.md exists → formal task completion
      if (existsSync(handoffPath) && !session.handoffProcessed) {
        const ok = await processHandoff({
          issueKey: session.issueKey,
          role: session.role,
          handoffPath,
          workspace,
          spawnedAt: session.spawnedAt,
          markSessionIdle: true,
        });
        if (ok) session.handoffProcessed = true;
        continue;
      }

      // SUSPEND.md exists → suspended (capacity eviction)
      if (existsSync(suspendPath)) {
        log.info(`${session.role}/${session.issueKey}: SUSPEND.md → suspended`, { role: session.role, issueKey: session.issueKey });
        // Auto-comment on task for dashboard visibility
        const suspendContent = readFileSync(suspendPath, 'utf-8').trim();
        const suspendReason = suspendContent.length > 200 ? suspendContent.substring(0, 200) + '...' : suspendContent;
        const suspendTaskId = resolveTaskIdFromIssueKey(session.issueKey);
        if (suspendTaskId) {
          addTaskComment(suspendTaskId, `agent:${session.role}`, `Suspended: ${suspendReason || 'capacity eviction'}`);
        }
        markSuspended(session.issueKey);
        bus.emit('agent:suspended', { role: session.role, issueKey: session.issueKey, reason: 'SUSPEND.md' });
        continue;
      }

      // BLOCKED.md exists → agent hit a blocker → suspended + notify CEO
      if (existsSync(blockedPath)) {
        log.info(`${session.role}/${session.issueKey}: BLOCKED.md → suspended (blocked)`, { role: session.role, issueKey: session.issueKey });
        const blockedContent = readFileSync(blockedPath, 'utf-8').trim();
        const blockedReason = blockedContent.length > 200 ? blockedContent.substring(0, 200) + '...' : blockedContent;
        const blockedTaskId = resolveTaskIdFromIssueKey(session.issueKey);
        if (blockedTaskId) {
          setTaskState(blockedTaskId, 'suspended');
          addTaskComment(blockedTaskId, `agent:${session.role}`, `Blocked: ${blockedReason || 'unknown reason'}`);
        }
        createNotification({
          kind: 'alert',
          severity: 'warning',
          title: `Agent blocked: ${session.issueKey}`,
          body: blockedReason || 'unknown reason',
          taskId: blockedTaskId ?? null,
          agentRole: session.role,
        });
        await addComment(session.issueKey, `**${session.role}** blocked: ${blockedReason || 'unknown reason'}`, session.role).catch(() => {});
        markSuspended(session.issueKey);
        bus.emit('agent:blocked', { role: session.role, issueKey: session.issueKey, reason: blockedReason || 'unknown reason' });
        continue;
      }

      // Nothing → session died with no artifacts.
      // If the session ran for >60s without producing HANDOFF/BLOCKED/SUSPEND,
      // treat it as an unexpected crash. Short sessions are normal lightweight completions.
      const elapsedMs = Date.now() - session.spawnedAt;
      const isCrash = elapsedMs > 60_000;

      try {
        const costUsd = estimateCostFromElapsed(session.role, session.spawnedAt);
        recordSpend(session.role, session.issueKey, 0, costUsd);
      } catch (err) {
        log.error(`recordSpend failed: ${(err as Error).message}`, { role: session.role, issueKey: session.issueKey });
      }

      if (isCrash) {
        log.warn(`${session.role}/${session.issueKey}: session crashed (no artifacts after ${Math.round(elapsedMs / 1000)}s)`, { role: session.role, issueKey: session.issueKey });
        const crashTaskId = resolveTaskIdFromIssueKey(session.issueKey);
        if (crashTaskId) {
          setTaskState(crashTaskId, 'failed', Date.now());
          addTaskComment(crashTaskId, `agent:${session.role}`, 'Session crashed unexpectedly. Manual intervention may be needed.');
        }
        createNotification({
          kind: 'failure',
          severity: 'critical',
          title: `Agent crashed: ${session.issueKey}`,
          body: `${session.role} session died unexpectedly after ${Math.round(elapsedMs / 1000)}s with no HANDOFF/BLOCKED/SUSPEND.`,
          taskId: crashTaskId ?? null,
          agentRole: session.role,
        });
        markIdle(session.issueKey);
        bus.emit('agent:crashed', { role: session.role, issueKey: session.issueKey });
      } else {
        log.debug(`${session.role}/${session.issueKey}: session ended → idle`, { role: session.role, issueKey: session.issueKey });
        markIdle(session.issueKey);
        bus.emit('agent:idle', { role: session.role, issueKey: session.issueKey });
      }
    }
  });
}

// processHandoff and processRetro are now in handoff-processor.ts
