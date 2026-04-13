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

const hasSummarySection: QualityCheck = (h) => ({
  pass: /^## Summary/m.test(h),
  warning: 'Your `HANDOFF.md` is missing a `## Summary` section. Please add a summary of what you did.',
});

const hasVerificationSection: QualityCheck = (h) => ({
  pass: /^## Verification/m.test(h),
  warning: 'Your `HANDOFF.md` is missing a `## Verification` section. Please add what you tested/verified before delivery.',
});

const hasVerificationEvidence: QualityCheck = (h) => {
  const section = extractVerificationSection(h);
  if (!section) return { pass: false, warning: 'No verification evidence in `HANDOFF.md`' };
  // Concrete evidence: command outputs (backtick blocks, $ prompts), numbers, file paths, HTTP status codes
  const hasCommandOutput = /(`[^`]+`|^\$\s+|```[\s\S]*?```)/m.test(section);
  const hasNumbers = /\b\d+\s*(tests?|passing|failed|lines?|files?|bytes?|ms|seconds?|%|errors?)\b/i.test(section);
  const hasFilePaths = /[\w/-]+\.(ts|js|py|md|json|yaml|yml|html|css|sh)\b/.test(section);
  const hasHttpCodes = /\b(200|201|204|301|302|400|401|403|404|500)\b/.test(section);
  const hasConcrete = hasCommandOutput || hasNumbers || hasFilePaths || hasHttpCodes;
  return {
    pass: hasConcrete,
    warning: hasConcrete ? undefined : 'Verification section lacks concrete evidence (command outputs, test results, file paths, or measurements). Please add specifics.',
  };
};

/** Extract the content of the ## Verification section. */
function extractVerificationSection(handoff: string): string | null {
  const marker = '## Verification';
  const idx = handoff.indexOf(marker);
  if (idx === -1) return null;
  const start = idx + marker.length;
  // Find next ## header or end of string
  const rest = handoff.slice(start);
  const nextHeader = rest.search(/^## /m);
  // nextHeader === 0 means the very first char is '## ' which shouldn't happen after slicing past marker
  const section = nextHeader > 0 ? rest.slice(0, nextHeader) : rest;
  return section.trim();
}

const hasVerification: QualityCheck = (h) => ({
  pass: /\b(pass|verified|confirmed|fixed|resolved|works|tested|green)\b/i.test(h),
  warning: 'No verification evidence in `HANDOFF.md`',
});

const GATES: Record<TaskType, QualityCheck[]> = {
  code: [hasContent, hasSummarySection, hasVerificationSection, hasVerificationEvidence, hasVerification],
  strategy: [hasContent, hasSummarySection],
  research: [hasContent, hasSummarySection],
  ops: [hasContent, hasSummarySection, hasVerificationSection],
  trivial: [],
};

// --- Quality scoring ---

export interface QualityScore {
  total: number;
  breakdown: {
    hasSummary: number;
    hasVerification: number;
    verificationEvidence: number;
    mentionsFiles: number;
    reasonableLength: number;
  };
}

/**
 * Compute a 0-100 quality score for a HANDOFF.md.
 *   - Has ## Summary section: 20pts
 *   - Has ## Verification section: 30pts
 *   - Verification has concrete evidence: 20pts
 *   - Mentions files changed: 15pts
 *   - Reasonable length (>200 chars): 15pts
 */
export function computeQualityScore(handoff: string): QualityScore {
  const hasSummary = /^## Summary/m.test(handoff) ? 20 : 0;
  const hasVerif = /^## Verification/m.test(handoff) ? 30 : 0;

  let verifEvidence = 0;
  if (hasVerif) {
    const section = extractVerificationSection(handoff) ?? '';
    const hasCmd = /(`[^`]+`|^\$\s+|```[\s\S]*?```)/m.test(section);
    const hasNums = /\b\d+\s*(tests?|passing|failed|lines?|files?|bytes?|ms|seconds?|%|errors?)\b/i.test(section);
    if (hasCmd || hasNums) verifEvidence = 20;
  }

  const mentionsFiles = /[\w/-]+\.(ts|js|py|md|json|yaml|yml|html|css|sh)\b/.test(handoff) ? 15 : 0;
  const reasonableLength = handoff.trim().length > 200 ? 15 : 0;

  return {
    total: hasSummary + hasVerif + verifEvidence + mentionsFiles + reasonableLength,
    breakdown: {
      hasSummary,
      hasVerification: hasVerif,
      verificationEvidence: verifEvidence,
      mentionsFiles,
      reasonableLength,
    },
  };
}

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
// Prevent duplicate processing — HANDOFF.md can be detected by BOTH the
// Stop hook (hook-handler.ts) and the tick-based on-complete.ts. Without
// this guard, each tick creates duplicate child tasks + comments.
const processedHandoffs = new Set<string>();

export async function processHandoff(params: ProcessHandoffParams): Promise<boolean> {
  const { issueKey, role, handoffPath, workspace, spawnedAt, markSessionIdle = true } = params;

  // Dedup: skip if we already processed this exact handoff file
  const dedupKey = `${issueKey}:${handoffPath}`;
  if (processedHandoffs.has(dedupKey)) {
    return true; // already processed, report success
  }

  const handoff = readFileSync(handoffPath, 'utf-8');
  if (!handoff || handoff.trim().length === 0) return false;

  // Mark as processed BEFORE doing anything to prevent concurrent/tick races
  processedHandoffs.add(dedupKey);

  log.info(`${role}/${issueKey}: HANDOFF.md → processing`, { role, issueKey });

  // Quality gates
  const taskType = detectTaskType(issueKey, []);
  const checks = GATES[taskType];
  const warnings: string[] = [];
  for (const check of checks) {
    const result = check(handoff);
    if (!result.pass && result.warning) warnings.push(result.warning);
  }

  // Quality score
  const qualityScore = computeQualityScore(handoff);
  log.info(`${issueKey}: quality score ${qualityScore.total}/100`, { issueKey, role });

  // Emit quality score event for task_events logging
  const scoreTaskId = resolveTaskIdFromIssueKey(issueKey);
  if (scoreTaskId) {
    void bus.emit('task:quality-score' as keyof import('../bus.js').AncEvents, {
      taskId: scoreTaskId,
      role,
      score: qualityScore.total,
      breakdown: qualityScore.breakdown,
    } as never);
  }

  if (qualityScore.total < 50) {
    warnings.push(`Quality score ${qualityScore.total}/100 is below threshold. Please improve your HANDOFF.md with concrete verification evidence, file references, and a clear summary.`);
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
  // Linear comment — best-effort (may fail without OAuth; must NOT block dispatch)
  try {
    await addComment(issueKey, commentBody, role);
  } catch (err) {
    log.warn(`Linear addComment failed (non-blocking): ${(err as Error).message}`, { issueKey });
  }

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

  // Execute dispatches — each creates a sub-task (and optionally a Linear sub-issue)
  if (actions?.dispatches && actions.dispatches.length > 0) {
    const previousContext = summary.length > 500
      ? summary.substring(0, 500) + '...'
      : summary;

    for (const dispatch of actions.dispatches) {
      const subTitle = dispatch.newIssue || `${dispatch.role}: follow-up on ${issueKey}`;
      const subDesc = `Previous agent (${role}) completed their phase:\n\n${previousContext}\n\n---\n\n${dispatch.context}`;

      // Try creating a Linear sub-issue (best-effort — may fail without OAuth)
      let subKey: string | null = null;
      try {
        subKey = await createSubIssue(issueKey, subTitle, subDesc, dispatch.priority ?? 3, dispatch.role);
        if (subKey) log.info(`Created Linear sub-issue ${subKey} → ${dispatch.role}`, { issueKey });
      } catch (err) {
        log.warn(`Linear sub-issue creation failed (non-blocking): ${(err as Error).message}`, { issueKey });
      }

      // Always create a local ANC task — this is the primary dispatch mechanism
      try {
        const childTask = createTask({
          title: subTitle,
          description: dispatch.context,
          priority: dispatch.priority ?? 3,
          source: 'dispatch',
          projectId: parentTask?.projectId ?? null,
          parentTaskId: parentTaskId ?? null,
          linearIssueKey: subKey ?? undefined,
          createdBy: role,
        });
        log.info(`Created ANC sub-task ${childTask.id} → ${dispatch.role}`, { issueKey });

        void bus.emit('task:dispatched', {
          taskId: childTask.id,
          role: dispatch.role,
          parentTaskId: parentTaskId ?? null,
        });

        // Resolve session using Linear key if available, otherwise the ANC task ID
        const sessionKey = subKey ?? childTask.id;
        resolveSession({ role: dispatch.role, issueKey: sessionKey, prompt: dispatch.context, priority: dispatch.priority, taskId: childTask.id });
      } catch (err) {
        log.error(`Failed to create child task for dispatch: ${(err as Error).message}`, { issueKey });
      }
    }
  }

  // Set status on Linear — best-effort (may fail without OAuth; must NOT block ANC lifecycle)
  try {
    const issue = await getIssue(issueKey);
    if (issue) {
      const linearOk = await setIssueStatus(issue.id, newStatus, role);
      if (linearOk && actions?.delegate) {
        log.debug(`Delegate → ${actions.delegate}`, { issueKey });
      }
      if (!linearOk) {
        log.warn(`${issueKey}: Linear status change failed (non-blocking)`, { issueKey });
      }
    }
  } catch (err) {
    log.warn(`Linear status update failed (non-blocking): ${(err as Error).message}`, { issueKey });
  }

  // Set parent status if specified (Linear — best-effort)
  if (actions?.parentStatus) {
    try {
      const parentIssueObj = await getIssue(issueKey);
      const parentLinearIssue = parentIssueObj?.parentId ? await getIssue(parentIssueObj.parentId) : null;
      if (parentLinearIssue) {
        await setIssueStatus(parentLinearIssue.id, actions.parentStatus, role);
        log.info(`Parent ${parentLinearIssue.identifier} → ${actions.parentStatus}`, { issueKey });
      }
    } catch { /**/ }
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

  // Set the ANC task state + write handoffSummary to the task record.
  // This MUST happen regardless of Linear status — ANC is the primary system.
  if (parentTaskId) {
    try {
      const statusMap: Record<string, string> = {
        'Done': 'done',
        'In Review': 'review',
        'In Progress': 'running',
        'Todo': 'todo',
        'Canceled': 'canceled',
        'Cancelled': 'canceled',
        // Direct ANC state values (agent may use these instead of Linear names)
        'done': 'done',
        'review': 'review',
        'running': 'running',
        'todo': 'todo',
        'failed': 'failed',
        'canceled': 'canceled',
        'suspended': 'suspended',
      };
      const taskState = (statusMap[newStatus] ?? 'review') as import('../core/tasks.js').TaskState;
      setTaskState(parentTaskId, taskState, Date.now());

      // Fix 5: write handoffSummary to the task record so GET /tasks/:id returns it
      const handoffSummaryText = summary.substring(0, 2000);
      updateTask(parentTaskId, { handoffSummary: handoffSummaryText });
      log.info(`${issueKey}: wrote handoffSummary to task ${parentTaskId} (${handoffSummaryText.length} chars)`, { issueKey });

      void bus.emit('task:completed', {
        taskId: parentTaskId,
        handoffSummary: handoffSummaryText,
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
