/**
 * Completion handler — detects HANDOFF.md and runs quality gates.
 * Task-type-aware: different checks for code vs strategy vs research.
 */

import { bus } from '../bus.js';
import { getTrackedSessions, untrackSession } from '../runtime/health.js';
import { hasHandoff, readHandoff, type WorkspaceInfo } from '../runtime/workspace.js';
import { getWorkspacePath } from '../runtime/workspace.js';
import { addComment, setIssueStatus } from '../linear/client.js';
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

// --- Quality checks per task type ---

type QualityCheck = (handoff: string, workspace: WorkspaceInfo) => { pass: boolean; warning?: string };

const hasContent: QualityCheck = (handoff) => ({
  pass: handoff.trim().length > 50,
  warning: 'HANDOFF.md is too short — please describe what was done',
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
  trivial: [],  // auto-close, no checks
};

// --- Status decision ---

function decideStatus(taskType: TaskType, handoff: string): IssueStatus {
  // Trivial issues with success signals → auto-done
  if (taskType === 'trivial' && /\b(pass|fixed|done|resolved|verified)\b/i.test(handoff)) {
    return 'Done';
  }
  // Everything else → In Review for CEO
  return 'In Review';
}

// --- Completion monitor (periodic check) ---

export function registerCompletionHandlers(): void {
  // Periodic health + completion check
  bus.on('system:tick', async () => {
    const sessions = getTrackedSessions();

    for (const session of sessions) {
      const workspacePath = getWorkspacePath(session.issueKey);
      const workspace: WorkspaceInfo = {
        root: workspacePath,
        ancDir: `${workspacePath}/.anc`,
        codeDir: `${workspacePath}/code`,
        claudeDir: `${workspacePath}/.claude`,
        memoryDir: `${workspacePath}/.agent-memory`,
        handoffPath: `${workspacePath}/HANDOFF.md`,
      };

      // Check if process died without HANDOFF
      if (!sessionExists(session.tmuxSession)) {
        if (!hasHandoff(workspace)) {
          console.log(chalk.yellow(`[complete] ${session.role} on ${session.issueKey}: died without HANDOFF`));
          bus.emit('agent:failed', { role: session.role, issueKey: session.issueKey, error: 'session ended without HANDOFF.md' });
          untrackSession(session.tmuxSession);
          continue;
        }
      }

      // Check for HANDOFF.md
      if (hasHandoff(workspace)) {
        const handoff = readHandoff(workspace);
        if (!handoff) continue;

        console.log(chalk.green(`[complete] ${session.role} on ${session.issueKey}: HANDOFF detected`));

        // Detect task type (using issue key as title fallback)
        const taskType = detectTaskType(session.issueKey, []);

        // Run quality checks
        const checks = GATES[taskType];
        const warnings: string[] = [];
        for (const check of checks) {
          const result = check(handoff, workspace);
          if (!result.pass && result.warning) {
            warnings.push(result.warning);
          }
        }

        // Post HANDOFF as comment
        const summary = handoff.length > 2000 ? handoff.substring(0, 2000) + '\n\n...(truncated)' : handoff;
        let commentBody = summary;
        if (warnings.length > 0) {
          commentBody += `\n\n**Quality check warnings:**\n${warnings.map(w => `- ⚠️ ${w}`).join('\n')}`;
        }

        // Post comment and update status
        await addComment(session.issueKey, commentBody, session.role);

        const newStatus = decideStatus(taskType, handoff);
        // Note: setIssueStatus needs the issue UUID, not identifier.
        // For now we log — the Linear client will need to resolve identifier→id.

        console.log(chalk.green(`[complete] ${session.issueKey} → ${newStatus}`));

        bus.emit('agent:completed', { role: session.role, issueKey: session.issueKey, handoff });
        untrackSession(session.tmuxSession);
      }
    }
  });
}
