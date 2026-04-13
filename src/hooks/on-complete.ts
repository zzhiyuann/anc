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
 */

import { existsSync, readFileSync, readdirSync, statSync, unlinkSync } from 'fs';
import { join } from 'path';
import { bus } from '../bus.js';
import {
  getTrackedSessions, untrackSession, markIdle, markSuspended,
} from '../runtime/health.js';
import { getWorkspacePath } from '../runtime/workspace.js';
import { addComment, getIssue, setIssueStatus, createSubIssue } from '../linear/client.js';
import { parseActions, extractSummary, type HandoffActions } from './actions-parser.js';
import { resolveSession } from '../runtime/runner.js';
import { sessionExists } from '../runtime/runner.js';
import type { TaskType, IssueStatus } from '../linear/types.js';
import { createLogger } from '../core/logger.js';
import { recordSpend, estimateCost } from '../core/budget.js';
import { resolveTaskIdFromIssueKey, setTaskState, createTask, getTask, addTaskComment } from '../core/tasks.js';
import { setCooldown } from '../routing/queue.js';

const log = createLogger('complete');

/**
 * Heuristic cost estimator from elapsed runtime.
 * Claude Code outputs session cost in its final message, but the tmux-based
 * runner doesn't capture a structured total. Fall back to $0.10/minute active
 * (a conservative rough match for mid-usage sessions), clamped to the per-role
 * floor so trivial sessions still get logged.
 */
function estimateCostFromElapsed(role: string, spawnedAt: number): number {
  const elapsedMinutes = Math.max(0, (Date.now() - spawnedAt) / 60_000);
  const timeBased = elapsedMinutes * 0.10;
  return Math.max(timeBased, estimateCost(role));
}

/** Escape bare filenames (.md, .html, .ts, etc.) with backticks to prevent Linear auto-linking.
 *  e.g. "HANDOFF.md" → "`HANDOFF.md`", but already-backticked "`foo.md`" stays unchanged. */
function escapeFilenames(text: string): string {
  // Match filenames not already in backticks: word chars + dots ending in known extensions
  return text.replace(/(?<!`)(\b[\w.-]+\.(md|html|ts|js|json|yaml|yml|txt|css|sh|py|docx|pptx|pdf)\b)(?!`)/gi, '`$1`');
}

// --- Task type detection ---

const TRIVIAL_RE = /\b(test|fix|hotfix|typo|lint|cleanup|rename|bump|patch|chore|refactor|nit)\b/i;
const STRATEGY_RE = /\b(strategy|plan|brainstorm|evaluate|ideas|roadmap|pricing)\b/i;
const RESEARCH_RE = /\b(research|paper|survey|literature|analysis|study|benchmark)\b/i;

export function detectTaskType(title: string, labels: string[]): TaskType {
  if (TRIVIAL_RE.test(title)) return 'trivial';
  if (labels.some(l => /strategy|product/i.test(l)) || STRATEGY_RE.test(title)) return 'strategy';
  if (labels.some(l => /research/i.test(l)) || RESEARCH_RE.test(title)) return 'research';
  if (labels.some(l => /ops|infra|deploy/i.test(l))) return 'ops';
  return 'code';
}

// --- Quality checks ---

type QualityCheck = (handoff: string) => { pass: boolean; warning?: string };

const hasContent: QualityCheck = (h) => ({
  pass: h.trim().length > 50,
  warning: '`HANDOFF.md` is too short',
});

const hasVerification: QualityCheck = (h) => ({
  pass: /\b(pass|verified|confirmed|fixed|resolved|works|tested|green)\b/i.test(h),
  warning: 'No verification evidence in `HANDOFF.md`',
});

const GATES: Record<TaskType, QualityCheck[]> = {
  code: [hasContent, hasVerification],
  strategy: [hasContent],
  research: [hasContent],
  ops: [hasContent],
  trivial: [],
};

function decideStatus(taskType: TaskType, handoff: string): IssueStatus {
  if (taskType === 'trivial' && /\b(pass|fixed|done|resolved|verified)\b/i.test(handoff)) return 'Done';
  return 'In Review';
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

      // Still working — skip
      if (alive) continue;

      // --- tmux is dead. Determine what happened. ---

      // HANDOFF.md exists → formal task completion
      if (existsSync(handoffPath) && !session.handoffProcessed) {
        await processHandoff(session, handoffPath, workspace);
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

      // BLOCKED.md exists → agent hit a blocker
      if (existsSync(blockedPath)) {
        log.info(`${session.role}/${session.issueKey}: BLOCKED.md → blocked`, { role: session.role, issueKey: session.issueKey });
        const blockedContent = readFileSync(blockedPath, 'utf-8').trim();
        const blockedReason = blockedContent.length > 200 ? blockedContent.substring(0, 200) + '...' : blockedContent;
        const blockedTaskId = resolveTaskIdFromIssueKey(session.issueKey);
        if (blockedTaskId) {
          addTaskComment(blockedTaskId, `agent:${session.role}`, `Blocked: ${blockedReason || 'unknown reason'}`);
        }
        await addComment(session.issueKey, `**${session.role}** blocked: ${blockedReason || 'unknown reason'}`, session.role).catch(() => {});
        markIdle(session.issueKey);
        bus.emit('agent:idle', { role: session.role, issueKey: session.issueKey });
        continue;
      }

      // Nothing → lightweight completion (conversation ended, or task with no HANDOFF)
      // Mark idle — session can be reactivated via --continue if needed
      log.debug(`${session.role}/${session.issueKey}: session ended → idle`, { role: session.role, issueKey: session.issueKey });
      try {
        const costUsd = estimateCostFromElapsed(session.role, session.spawnedAt);
        recordSpend(session.role, session.issueKey, 0, costUsd);
      } catch (err) {
        log.error(`recordSpend failed: ${(err as Error).message}`, { role: session.role, issueKey: session.issueKey });
      }
      markIdle(session.issueKey);
      bus.emit('agent:idle', { role: session.role, issueKey: session.issueKey });
    }
  });
}

async function processHandoff(
  session: { role: string; issueKey: string; spawnedAt: number; handoffProcessed: boolean },
  handoffPath: string,
  workspace: string,
): Promise<void> {
  const handoff = readFileSync(handoffPath, 'utf-8');
  if (!handoff || handoff.trim().length === 0) return;

  log.info(`${session.role}/${session.issueKey}: HANDOFF.md → processing`, { role: session.role, issueKey: session.issueKey });

  // Quality gates
  const taskType = detectTaskType(session.issueKey, []);
  const checks = GATES[taskType];
  const warnings: string[] = [];
  for (const check of checks) {
    const result = check(handoff);
    if (!result.pass && result.warning) warnings.push(result.warning);
  }

  // Memory validation
  const memDir = join(workspace, '.agent-memory');
  if (existsSync(memDir)) {
    try {
      const memFiles = readdirSync(memDir).filter(f => f.endsWith('.md'));
      const newFiles = memFiles.filter(f => {
        try {
          return statSync(join(memDir, f)).mtimeMs > session.spawnedAt;
        } catch { return false; }
      });
      if (newFiles.length === 0 && taskType !== 'trivial') {
        warnings.push('No memory files updated during this session');
      }
    } catch { /**/ }
  }

  // Post HANDOFF as comment
  let body = handoff.length > 2000 ? handoff.substring(0, 2000) + '\n\n...(truncated)' : handoff;
  if (warnings.length > 0) {
    body += `\n\n**Quality check warnings:**\n${warnings.map(w => `- ${w}`).join('\n')}`;
  }
  // Parse structured Actions block (agent-decided)
  const actions = parseActions(handoff);
  const summary = extractSummary(handoff);

  // Post summary as comment — escape bare filenames to prevent Linear auto-linking
  const escapedSummary = escapeFilenames(summary);
  let commentBody = escapedSummary.length > 2000 ? escapedSummary.substring(0, 2000) + '\n\n...(truncated)' : escapedSummary;
  if (warnings.length > 0) {
    commentBody += `\n\n**Quality check warnings:**\n${warnings.map(w => `- ${w}`).join('\n')}`;
  }
  await addComment(session.issueKey, commentBody, session.role);

  // Auto-comment on local task for dashboard visibility
  const taskId = resolveTaskIdFromIssueKey(session.issueKey);
  if (taskId) {
    const statusLabel = actions?.status ?? decideStatus(taskType, handoff);
    const shortSummary = summary.length > 500 ? summary.substring(0, 500) + '...' : summary;
    addTaskComment(taskId, `agent:${session.role}`, `Completed. Summary: ${shortSummary}\n\nStatus: ${statusLabel}`);
  }

  // Determine status: agent-decided (from Actions) or system-decided (fallback)
  const newStatus = actions?.status ?? decideStatus(taskType, handoff);
  log.info(`${session.issueKey} → ${newStatus}${actions ? ' (agent-decided)' : ' (system-decided)'}`, { issueKey: session.issueKey });

  // Resolve parent task once — child tasks inherit this id and project.
  const parentTaskId = resolveTaskIdFromIssueKey(session.issueKey);
  const parentTask = parentTaskId ? getTask(parentTaskId) : null;

  // Execute dispatches — each creates a sub-issue (one issue = one agent)
  if (actions?.dispatches && actions.dispatches.length > 0) {
    const previousContext = summary.length > 500
      ? summary.substring(0, 500) + '...'
      : summary;

    for (const dispatch of actions.dispatches) {
      // Every dispatch creates a sub-issue — context passes through the description
      const subTitle = dispatch.newIssue || `${dispatch.role}: follow-up on ${session.issueKey}`;
      const subDesc = `Previous agent (${session.role}) completed their phase:\n\n${previousContext}\n\n---\n\n${dispatch.context}`;

      const subKey = await createSubIssue(session.issueKey, subTitle, subDesc, dispatch.priority ?? 3, dispatch.role);
      if (subKey) {
        log.info(`Created sub-issue ${subKey} → ${dispatch.role}`, { issueKey: session.issueKey });

        // Wave 2A: mirror the dispatch into a local child task so the
        // dashboard shows parent/child hierarchy even before Linear syncs.
        try {
          const childTask = createTask({
            title: subTitle,
            description: dispatch.context,
            priority: dispatch.priority ?? 3,
            source: 'dispatch',
            projectId: parentTask?.projectId ?? null,
            parentTaskId: parentTaskId ?? null,
            linearIssueKey: subKey,
            createdBy: session.role,
          });
          void bus.emit('task:dispatched', {
            taskId: childTask.id,
            role: dispatch.role,
            parentTaskId: parentTaskId ?? null,
          });
        } catch (err) {
          log.warn(`failed to create child task: ${(err as Error).message}`);
        }

        resolveSession({ role: dispatch.role, issueKey: subKey, prompt: dispatch.context, priority: dispatch.priority });
      }
    }
  }

  // Set status on Linear
  const issue = await getIssue(session.issueKey);
  let statusChanged = false;
  if (issue) {
    statusChanged = await setIssueStatus(issue.id, newStatus, session.role);

    // Set delegate if specified
    if (actions?.delegate && statusChanged) {
      // Delegate is set by dispatching — the resolveSession already handles this
      log.debug(`Delegate → ${actions.delegate}`, { issueKey: session.issueKey });
    }
  }

  // Set parent status if specified
  if (actions?.parentStatus && statusChanged) {
    try {
      const parentIssue = issue?.parentId ? await getIssue(issue.parentId) : null;
      if (parentIssue) {
        await setIssueStatus(parentIssue.id, actions.parentStatus, session.role);
        log.info(`Parent ${parentIssue.identifier} → ${actions.parentStatus}`, { issueKey: session.issueKey });
      }
    } catch { /**/ }
  }

  if (!statusChanged) {
    log.warn(`${session.issueKey}: status change failed, will retry next tick`);
    return;
  }

  // Cooldown: prevent rapid-fire re-dispatch after completion (30s per-task)
  setCooldown(session.issueKey, 30_000);

  // Status changed successfully — archive HANDOFF to prevent re-triggering
  session.handoffProcessed = true;
  try {
    const archivePath = join(workspace, `HANDOFF-${Date.now()}.md`);
    const { renameSync } = await import('fs');
    renameSync(handoffPath, archivePath);
  } catch { /**/ }

  // Process RETRO.md → append to shared memory
  await processRetro(session.role, session.issueKey, workspace);

  // Record spend for this session (elapsed-time heuristic — no structured cost from claude -p)
  try {
    const costUsd = estimateCostFromElapsed(session.role, session.spawnedAt);
    recordSpend(session.role, session.issueKey, 0, costUsd);
  } catch (err) {
    log.error(`recordSpend failed: ${(err as Error).message}`, { role: session.role, issueKey: session.issueKey });
  }

  markIdle(session.issueKey);

  // Wave 2A: set the parent task state based on the decided Linear status.
  // 'Done' → done, 'In Review' → review, anything else → failed (best-effort).
  if (parentTaskId) {
    try {
      const taskState =
        newStatus === 'Done' ? 'done'
        : newStatus === 'In Review' ? 'review'
        : 'failed';
      setTaskState(parentTaskId, taskState, Date.now());
      void bus.emit('task:completed', {
        taskId: parentTaskId,
        handoffSummary: summary.substring(0, 2000),
      });
    } catch (err) {
      log.warn(`failed to set task state: ${(err as Error).message}`);
    }
  }

  bus.emit('agent:completed', { role: session.role, issueKey: session.issueKey, handoff });
}

/** Process retrospective — append to shared memory for cross-session learning. */
async function processRetro(role: string, issueKey: string, workspace: string): Promise<void> {
  const retroPath = join(workspace, 'RETRO.md');
  if (!existsSync(retroPath)) return;

  try {
    const retro = readFileSync(retroPath, 'utf-8').trim();
    if (retro.length === 0) return;

    const { writeSharedMemory, readSharedMemory } = await import('../agents/memory.js');
    const filename = `retros-${role}.md`;
    const existing = readSharedMemory(filename) ?? `# ${role} Retrospectives\n`;

    // Append this retro (keep last 10 to avoid unbounded growth)
    const header = `\n## ${issueKey} — ${new Date().toISOString().split('T')[0]}\n`;
    const updated = existing + header + retro + '\n';

    // Trim to last 10 entries if needed
    const entries = updated.split(/\n## /).filter(Boolean);
    const trimmed = entries.length > 11
      ? entries[0] + '\n## ' + entries.slice(-10).join('\n## ')
      : updated;

    writeSharedMemory(filename, trimmed);
    log.info(`${role}/${issueKey}: retrospective saved to shared memory`, { role, issueKey });

    // Archive RETRO.md
    try { unlinkSync(retroPath); } catch { /**/ }
  } catch (err) {
    log.error(`Failed to process retro: ${(err as Error).message}`, { role, issueKey });
  }
}
