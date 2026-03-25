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
import { addComment } from '../linear/client.js';
import { sessionExists } from '../runtime/runner.js';
import type { TaskType, IssueStatus } from '../linear/types.js';
import chalk from 'chalk';

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
  warning: 'HANDOFF.md is too short',
});

const hasVerification: QualityCheck = (h) => ({
  pass: /\b(pass|verified|confirmed|fixed|resolved|works|tested|green)\b/i.test(h),
  warning: 'No verification evidence in HANDOFF.md',
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
        console.log(chalk.yellow(`[complete] ${session.role}/${session.issueKey}: SUSPEND.md → suspended`));
        markSuspended(session.issueKey);
        bus.emit('agent:suspended', { role: session.role, issueKey: session.issueKey, reason: 'SUSPEND.md' });
        continue;
      }

      // Nothing → lightweight completion (conversation ended, or task with no HANDOFF)
      // Mark idle — session can be reactivated via --continue if needed
      console.log(chalk.dim(`[complete] ${session.role}/${session.issueKey}: session ended → idle`));
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

  console.log(chalk.green(`[complete] ${session.role}/${session.issueKey}: HANDOFF.md → processing`));

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
  await addComment(session.issueKey, body, session.role);

  const newStatus = decideStatus(taskType, handoff);
  console.log(chalk.green(`[complete] ${session.issueKey} → ${newStatus}`));

  // Mark handoff processed, transition to idle (session stays in registry for follow-ups)
  session.handoffProcessed = true;
  // Don't delete HANDOFF.md — it's part of the workspace record
  // But rename to prevent re-triggering
  try {
    const archivePath = join(workspace, `HANDOFF-${Date.now()}.md`);
    const { renameSync } = await import('fs');
    renameSync(handoffPath, archivePath);
  } catch { /**/ }

  markIdle(session.issueKey);
  bus.emit('agent:completed', { role: session.role, issueKey: session.issueKey, handoff });
}
