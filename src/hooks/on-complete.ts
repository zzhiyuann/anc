/**
 * Completion handler — detects HANDOFF.md and SUSPEND.md, runs quality gates.
 * Task-type-aware: different checks for code vs strategy vs research.
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { bus } from '../bus.js';
import { getTrackedSessions, untrackSession, markSuspended } from '../runtime/health.js';
import { hasHandoff, readHandoff, type WorkspaceInfo } from '../runtime/workspace.js';
import { getWorkspacePath } from '../runtime/workspace.js';
import { addComment } from '../linear/client.js';
import { sessionExists } from '../runtime/runner.js';
import type { TaskType, IssueStatus } from '../linear/types.js';
import chalk from 'chalk';

// --- Task type detection ---

const TRIVIAL_PATTERNS = /\b(test|fix|hotfix|typo|lint|cleanup|rename|bump|patch|chore|refactor|nit)\b/i;
const STRATEGY_PATTERNS = /\b(strategy|plan|brainstorm|evaluate|ideas|roadmap|pricing)\b/i;
const RESEARCH_PATTERNS = /\b(research|paper|survey|literature|analysis|study|benchmark)\b/i;

export function detectTaskType(title: string, labels: string[]): TaskType {
  if (TRIVIAL_PATTERNS.test(title)) return 'trivial';
  if (labels.some(l => /strategy|product/i.test(l)) || STRATEGY_PATTERNS.test(title)) return 'strategy';
  if (labels.some(l => /research/i.test(l)) || RESEARCH_PATTERNS.test(title)) return 'research';
  if (labels.some(l => /ops|infra|deploy/i.test(l))) return 'ops';
  return 'code';
}

// --- Quality checks ---

type QualityCheck = (handoff: string) => { pass: boolean; warning?: string };

const hasContent: QualityCheck = (handoff) => ({
  pass: handoff.trim().length > 50,
  warning: 'HANDOFF.md is too short',
});

const hasVerification: QualityCheck = (handoff) => ({
  pass: /\b(pass|verified|confirmed|fixed|resolved|works|tested|green)\b/i.test(handoff),
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
  if (taskType === 'trivial' && /\b(pass|fixed|done|resolved|verified)\b/i.test(handoff)) {
    return 'Done';
  }
  return 'In Review';
}

// --- Main tick handler ---

export function registerCompletionHandlers(): void {
  bus.on('system:tick', async () => {
    const sessions = getTrackedSessions();

    for (const session of sessions) {
      if (session.state !== 'active') continue;  // only check active sessions

      const workspacePath = getWorkspacePath(session.issueKey);
      const handoffPath = join(workspacePath, 'HANDOFF.md');
      const suspendPath = join(workspacePath, 'SUSPEND.md');
      const alive = sessionExists(session.tmuxSession);

      // --- HANDOFF.md detected → completion ---
      if (existsSync(handoffPath)) {
        const handoff = readFileSync(handoffPath, 'utf-8');
        if (!handoff || handoff.trim().length === 0) continue;

        console.log(chalk.green(`[complete] ${session.role}/${session.issueKey}: HANDOFF detected`));

        const taskType = detectTaskType(session.issueKey, []);
        const checks = GATES[taskType];
        const warnings: string[] = [];
        for (const check of checks) {
          const result = check(handoff);
          if (!result.pass && result.warning) warnings.push(result.warning);
        }

        // Post HANDOFF as comment
        let body = handoff.length > 2000 ? handoff.substring(0, 2000) + '\n\n...(truncated)' : handoff;
        if (warnings.length > 0) {
          body += `\n\n**Quality check warnings:**\n${warnings.map(w => `- ⚠️ ${w}`).join('\n')}`;
        }
        await addComment(session.issueKey, body, session.role);

        const newStatus = decideStatus(taskType, handoff);
        console.log(chalk.green(`[complete] ${session.issueKey} → ${newStatus}`));

        bus.emit('agent:completed', { role: session.role, issueKey: session.issueKey, handoff });
        untrackSession(session.issueKey);
        continue;
      }

      // --- SUSPEND.md detected (agent wrote checkpoint before being killed) ---
      if (existsSync(suspendPath) && !alive) {
        console.log(chalk.yellow(`[complete] ${session.role}/${session.issueKey}: SUSPEND.md found, session dead → marking suspended`));
        markSuspended(session.issueKey);
        bus.emit('agent:suspended', { role: session.role, issueKey: session.issueKey, reason: 'agent wrote SUSPEND.md' });
        continue;
      }

      // --- Process died without any artifact ---
      if (!alive) {
        console.log(chalk.red(`[complete] ${session.role}/${session.issueKey}: died without HANDOFF or SUSPEND`));
        bus.emit('agent:failed', { role: session.role, issueKey: session.issueKey, error: 'session died without artifacts' });
        untrackSession(session.issueKey);
      }
    }
  });
}
