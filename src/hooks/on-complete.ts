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
import { resolveTaskIdFromIssueKey, setTaskState, createTask, getTask, addTaskComment, updateTask } from '../core/tasks.js';
import { setCooldown } from '../routing/queue.js';
import { createNotification } from '../core/notifications.js';

const log = createLogger('complete');

/** Track last PROGRESS.md check time per issue to avoid re-reading unchanged files. */
const progressLastChecked = new Map<string, number>();

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

  // Agent is responsible for posting completion comments before writing HANDOFF.md.
  // System only handles status transitions, dispatches, and notifications.

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

    const { writeRetrospective, writeSharedMemory, readSharedMemory } = await import('../agents/memory.js');
    const dateStr = new Date().toISOString().split('T')[0];
    const shortId = issueKey.replace(/[^a-zA-Z0-9-]/g, '').toLowerCase();

    // Write to agent's retrospectives/ subdir with date-based filename
    const retroFilename = `${dateStr}-${shortId}.md`;
    const retroContent = `---\nimportance: normal\nupdated: ${dateStr}\n---\n# Retrospective: ${issueKey}\n\n${retro}\n`;
    writeRetrospective(role, retroFilename, retroContent);
    log.info(`${role}/${issueKey}: retrospective saved to retrospectives/${retroFilename}`, { role, issueKey });

    // Also append to shared memory for cross-agent learning (legacy compat)
    const filename = `retros-${role}.md`;
    const existing = readSharedMemory(filename) ?? `# ${role} Retrospectives\n`;

    const header = `\n## ${issueKey} — ${dateStr}\n`;
    const updated = existing + header + retro + '\n';

    // Trim to last 10 entries if needed
    const entries = updated.split(/\n## /).filter(Boolean);
    const trimmed = entries.length > 11
      ? entries[0] + '\n## ' + entries.slice(-10).join('\n## ')
      : updated;

    writeSharedMemory(filename, trimmed);
    log.info(`${role}/${issueKey}: retrospective also saved to shared memory`, { role, issueKey });

    // Archive RETRO.md
    try { unlinkSync(retroPath); } catch { /**/ }
  } catch (err) {
    log.error(`Failed to process retro: ${(err as Error).message}`, { role, issueKey });
  }
}
