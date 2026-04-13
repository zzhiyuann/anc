/**
 * Shared HANDOFF.md processor.
 *
 * Extracts the handoff processing logic so it can be called from:
 *   - on-complete.ts (legacy path: tmux died + HANDOFF.md exists)
 *   - hook-handler.ts (new path: Stop hook detects HANDOFF.md in interactive mode)
 *
 * This is the critical path that turns "agent wrote HANDOFF.md" into
 * status transitions, dispatch actions, comments, and cost recording.
 */

import { existsSync, readFileSync, readdirSync, statSync, unlinkSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { bus } from '../bus.js';
import { addComment, getIssue, setIssueStatus, createSubIssue } from '../linear/client.js';
import { parseActions, extractSummary, type HandoffActions } from './actions-parser.js';
import { resolveSession } from '../runtime/runner.js';
import type { TaskType, IssueStatus } from '../linear/types.js';
import { createLogger } from '../core/logger.js';
import { recordSpend, estimateCost } from '../core/budget.js';
import { resolveTaskIdFromIssueKey, setTaskState, createTask, getTask, addTaskComment, updateTask } from '../core/tasks.js';
import { setCooldown } from '../routing/queue.js';
import { createNotification } from '../core/notifications.js';
import { markIdle } from '../runtime/health.js';

const log = createLogger('handoff-processor');

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

/** Escape bare filenames with backticks to prevent Linear auto-linking. */
function escapeFilenames(text: string): string {
  return text.replace(/(?<!`)(\b[\w.-]+\.(md|html|ts|js|json|yaml|yml|txt|css|sh|py|docx|pptx|pdf)\b)(?!`)/gi, '`$1`');
}

/**
 * Heuristic cost estimator from elapsed runtime.
 * Falls back to $0.10/minute active, clamped to per-role floor.
 */
function estimateCostFromElapsed(role: string, spawnedAt: number): number {
  const elapsedMinutes = Math.max(0, (Date.now() - spawnedAt) / 60_000);
  const timeBased = elapsedMinutes * 0.10;
  return Math.max(timeBased, estimateCost(role));
}

export interface ProcessHandoffParams {
  issueKey: string;
  role: string;
  handoffPath: string;
  workspace: string;
  spawnedAt: number;
  /** If provided, marks session idle + archives HANDOFF. If omitted, caller manages session state. */
  markSessionIdle?: boolean;
}

/**
 * Process a HANDOFF.md artifact: quality gates, Linear status update,
 * dispatch children, post comments, record spend, archive the file.
 *
 * Returns true if handoff was processed successfully (status changed).
 */
export async function processHandoff(params: ProcessHandoffParams): Promise<boolean> {
  const { issueKey, role, handoffPath, workspace, spawnedAt, markSessionIdle = true } = params;

  const handoff = readFileSync(handoffPath, 'utf-8');
  if (!handoff || handoff.trim().length === 0) return false;

  log.info(`${role}/${issueKey}: HANDOFF.md → processing`, { role, issueKey });

  // Quality gates
  const taskType = detectTaskType(issueKey, []);
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
          return statSync(join(memDir, f)).mtimeMs > spawnedAt;
        } catch { return false; }
      });
      if (newFiles.length === 0 && taskType !== 'trivial') {
        warnings.push('No memory files updated during this session');
      }
    } catch { /**/ }
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
  await addComment(issueKey, commentBody, role);

  // Post the HANDOFF summary to the ANC task comments for dashboard visibility
  const completionTaskId = resolveTaskIdFromIssueKey(issueKey);
  if (completionTaskId) {
    const deliveryMsg = summary
      ? `Completed. ${summary.substring(0, 500)}`
      : 'Completed. See HANDOFF.md for details.';
    addTaskComment(completionTaskId, `agent:${role}`, deliveryMsg);
  }

  // Determine status: agent-decided (from Actions) or system-decided (fallback)
  const newStatus = actions?.status ?? decideStatus(taskType, handoff);
  log.info(`${issueKey} → ${newStatus}${actions ? ' (agent-decided)' : ' (system-decided)'}`, { issueKey });

  // Resolve parent task once — child tasks inherit this id and project.
  const parentTaskId = resolveTaskIdFromIssueKey(issueKey);
  const parentTask = parentTaskId ? getTask(parentTaskId) : null;

  // Execute dispatches — each creates a sub-issue (one issue = one agent)
  if (actions?.dispatches && actions.dispatches.length > 0) {
    const previousContext = summary.length > 500
      ? summary.substring(0, 500) + '...'
      : summary;

    for (const dispatch of actions.dispatches) {
      const subTitle = dispatch.newIssue || `${dispatch.role}: follow-up on ${issueKey}`;
      const subDesc = `Previous agent (${role}) completed their phase:\n\n${previousContext}\n\n---\n\n${dispatch.context}`;

      const subKey = await createSubIssue(issueKey, subTitle, subDesc, dispatch.priority ?? 3, dispatch.role);
      if (subKey) {
        log.info(`Created sub-issue ${subKey} → ${dispatch.role}`, { issueKey });

        try {
          const childTask = createTask({
            title: subTitle,
            description: dispatch.context,
            priority: dispatch.priority ?? 3,
            source: 'dispatch',
            projectId: parentTask?.projectId ?? null,
            parentTaskId: parentTaskId ?? null,
            linearIssueKey: subKey,
            createdBy: role,
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
  const issue = await getIssue(issueKey);
  let statusChanged = false;
  if (issue) {
    statusChanged = await setIssueStatus(issue.id, newStatus, role);

    if (actions?.delegate && statusChanged) {
      log.debug(`Delegate → ${actions.delegate}`, { issueKey });
    }
  }

  // Set parent status if specified
  if (actions?.parentStatus && statusChanged) {
    try {
      const parentIssue = issue?.parentId ? await getIssue(issue.parentId) : null;
      if (parentIssue) {
        await setIssueStatus(parentIssue.id, actions.parentStatus, role);
        log.info(`Parent ${parentIssue.identifier} → ${actions.parentStatus}`, { issueKey });
      }
    } catch { /**/ }
  }

  if (!statusChanged) {
    log.warn(`${issueKey}: status change failed, will retry next tick`);
    return false;
  }

  // Cooldown: prevent rapid-fire re-dispatch after completion (30s per-task)
  setCooldown(issueKey, 30_000);

  // Archive HANDOFF to prevent re-triggering
  try {
    const archivePath = join(workspace, `HANDOFF-${Date.now()}.md`);
    renameSync(handoffPath, archivePath);
  } catch { /**/ }

  // Process RETRO.md → append to shared memory
  await processRetro(role, issueKey, workspace);

  // Record spend for this session (elapsed-time heuristic)
  try {
    const costUsd = estimateCostFromElapsed(role, spawnedAt);
    recordSpend(role, issueKey, 0, costUsd);
  } catch (err) {
    log.error(`recordSpend failed: ${(err as Error).message}`, { role, issueKey });
  }

  if (markSessionIdle) {
    markIdle(issueKey);
  }

  // Set the parent task state based on the decided Linear status.
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

  bus.emit('agent:completed', { role, issueKey, handoff });
  return true;
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

    const retroFilename = `${dateStr}-${shortId}.md`;
    const retroContent = `---\nimportance: normal\nupdated: ${dateStr}\n---\n# Retrospective: ${issueKey}\n\n${retro}\n`;
    writeRetrospective(role, retroFilename, retroContent);
    log.info(`${role}/${issueKey}: retrospective saved to retrospectives/${retroFilename}`, { role, issueKey });

    const filename = `retros-${role}.md`;
    const existing = readSharedMemory(filename) ?? `# ${role} Retrospectives\n`;

    const header = `\n## ${issueKey} — ${dateStr}\n`;
    const updated = existing + header + retro + '\n';

    const entries = updated.split(/\n## /).filter(Boolean);
    const trimmed = entries.length > 11
      ? entries[0] + '\n## ' + entries.slice(-10).join('\n## ')
      : updated;

    writeSharedMemory(filename, trimmed);
    log.info(`${role}/${issueKey}: retrospective also saved to shared memory`, { role, issueKey });

    try { unlinkSync(retroPath); } catch { /**/ }
  } catch (err) {
    log.error(`Failed to process retro: ${(err as Error).message}`, { role, issueKey });
  }
}
