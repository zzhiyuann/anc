/**
 * Runner — spawns, suspends, and resumes agent processes in tmux sessions.
 *
 * Lifecycle:
 *   spawn()   → creates tmux session, injects persona, starts claude
 *   suspend() → tells agent to write SUSPEND.md, kills tmux, preserves workspace
 *   resume()  → reads SUSPEND.md, spawns new tmux with continuation prompt
 */

import { execSync } from 'child_process';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import chalk from 'chalk';
import type { AgentRole } from '../linear/types.js';
import {
  ensureWorkspace, writePersonaToWorkspace, writeAutoModeSettings,
  type WorkspaceInfo, getWorkspacePath,
} from './workspace.js';
import { buildPersona } from '../agents/persona.js';
import { bus } from '../bus.js';
import {
  trackSession, markSuspended, markResumed, hasCapacity,
  pickSessionToSuspend, getSessionForIssue,
} from './health.js';

export interface SpawnOptions {
  role: AgentRole;
  issueKey: string;
  prompt?: string;
  repoPath?: string;
  ceoAssigned?: boolean;
  priority?: number;
}

export interface SpawnResult {
  tmuxSession: string;
  workspace: WorkspaceInfo;
  success: boolean;
  error?: string;
  suspended?: string;  // issueKey of session that was suspended to make room
}

/** Spawn an agent — handles concurrency: suspends lowest-priority if at capacity */
export function spawnAgent(opts: SpawnOptions): SpawnResult {
  const { role, issueKey, prompt, repoPath, ceoAssigned, priority } = opts;
  const tmuxSession = `anc-${role}-${issueKey}`;

  // Check if this issue already has an active session
  const existing = getSessionForIssue(issueKey);
  if (existing?.state === 'active' && sessionExists(existing.tmuxSession)) {
    return { tmuxSession: existing.tmuxSession, workspace: ensureWorkspace(issueKey, role), success: true };
  }

  // If at capacity, try to make room by suspending
  let suspendedKey: string | undefined;
  if (!hasCapacity(role)) {
    const victim = pickSessionToSuspend(role);
    if (victim) {
      console.log(chalk.yellow(`[runner] Suspending ${victim.role}/${victim.issueKey} to make room for ${issueKey}`));
      suspendSession(victim.issueKey);
      suspendedKey = victim.issueKey;
    } else {
      // All sessions are CEO-assigned or protected — cannot make room
      console.log(chalk.yellow(`[runner] ${role} at capacity (all protected) — ${issueKey} must queue`));
      return { tmuxSession, workspace: ensureWorkspace(issueKey, role), success: false, error: 'at capacity, all sessions protected' };
    }
  }

  // Prepare workspace
  const workspace = ensureWorkspace(issueKey, role);
  const persona = buildPersona(role);
  writePersonaToWorkspace(workspace, persona);
  writeAutoModeSettings(workspace);

  // Build prompt
  const workDir = repoPath ? workspace.codeDir : workspace.root;
  const fullPrompt = buildPrompt(issueKey, prompt);

  // Write script
  const scriptPath = `/tmp/anc-spawn-${tmuxSession}.sh`;
  writeFileSync(scriptPath, buildSpawnScript(workDir, fullPrompt, role, issueKey), { mode: 0o755 });

  // Kill any stale tmux session with same name
  try { execSync(`tmux kill-session -t "${tmuxSession}" 2>/dev/null`, { stdio: 'pipe' }); } catch { /**/ }

  // Spawn
  try {
    execSync(
      `tmux new-session -d -s "${tmuxSession}" -c "${workDir}" "bash ${scriptPath}"`,
      { stdio: 'pipe', timeout: 10_000 },
    );

    console.log(chalk.green(`[runner] Spawned ${role} on ${issueKey} (tmux: ${tmuxSession})`));

    trackSession({
      role, issueKey, tmuxSession, spawnedAt: Date.now(),
      priority: priority ?? 3,
      ceoAssigned: ceoAssigned ?? false,
    });

    bus.emit('agent:spawned', { role, issueKey, tmuxSession });
    return { tmuxSession, workspace, success: true, suspended: suspendedKey };
  } catch (err) {
    const error = (err as Error).message;
    console.error(chalk.red(`[runner] Spawn failed: ${error}`));
    bus.emit('agent:failed', { role, issueKey, error });
    return { tmuxSession, workspace, success: false, error };
  }
}

// --- Suspend ---

/** Suspend a session: try to tell agent to checkpoint, then kill tmux.
 *  Workspace + SUSPEND.md are preserved for later resume. */
export function suspendSession(issueKey: string): boolean {
  const session = getSessionForIssue(issueKey);
  if (!session || session.state !== 'active') return false;

  const workspace = getWorkspacePath(issueKey);
  const suspendPath = join(workspace, 'SUSPEND.md');

  // Try to gracefully ask the agent to checkpoint (give 5s)
  if (sessionExists(session.tmuxSession)) {
    try {
      sendToAgent(session.tmuxSession,
        'SYSTEM: You are being suspended due to resource constraints. ' +
        'Write SUSPEND.md with your current progress and what to do next, then /exit immediately.'
      );
      // Give a brief window for the agent to write SUSPEND.md
      execSync('sleep 3', { stdio: 'pipe' });
    } catch { /**/ }
  }

  // If agent didn't write SUSPEND.md, write a minimal one
  if (!existsSync(suspendPath)) {
    writeFileSync(suspendPath, `# Suspended\n\nAuto-suspended at ${new Date().toISOString()}.\nNo agent checkpoint was captured.\n`, 'utf-8');
  }

  // Kill tmux
  killAgent(session.tmuxSession);

  // Update state
  markSuspended(issueKey);
  bus.emit('agent:suspended', { role: session.role, issueKey, reason: 'capacity' });
  console.log(chalk.yellow(`[runner] Suspended ${session.role}/${issueKey}`));

  return true;
}

// --- Resume ---

/** Resume a suspended session: read SUSPEND.md, spawn new tmux with continuation prompt. */
export function resumeSession(issueKey: string, additionalPrompt?: string): SpawnResult {
  const session = getSessionForIssue(issueKey);
  if (!session || session.state !== 'suspended') {
    return { tmuxSession: '', workspace: ensureWorkspace(issueKey, session?.role ?? 'engineer'), success: false, error: 'not suspended' };
  }

  const workspace = getWorkspacePath(issueKey);
  const suspendPath = join(workspace, 'SUSPEND.md');

  // Build resume prompt
  let resumePrompt = `You are RESUMING work on ${issueKey}. You were previously suspended.\n`;
  if (existsSync(suspendPath)) {
    const suspendContent = readFileSync(suspendPath, 'utf-8');
    resumePrompt += `\nYour checkpoint from last session:\n\n${suspendContent}\n`;
  }
  if (additionalPrompt) {
    resumePrompt += `\nNew context: ${additionalPrompt}\n`;
  }
  resumePrompt += `\nContinue where you left off. When done, write HANDOFF.md and /exit.`;

  // Spawn uses the normal path — it will handle workspace, persona, etc.
  const result = spawnAgent({
    role: session.role,
    issueKey,
    prompt: resumePrompt,
    priority: session.priority,
    ceoAssigned: session.ceoAssigned,
  });

  if (result.success) {
    markResumed(issueKey, result.tmuxSession);
    bus.emit('agent:resumed', { role: session.role, issueKey, tmuxSession: result.tmuxSession });
    console.log(chalk.green(`[runner] Resumed ${session.role}/${issueKey}`));
  }

  return result;
}

// --- Basic operations ---

export function sendToAgent(tmuxSession: string, message: string): boolean {
  try {
    const escaped = message.replace(/'/g, "'\\''");
    execSync(`tmux send-keys -t "${tmuxSession}" '${escaped}' Enter`, { stdio: 'pipe', timeout: 5000 });
    return true;
  } catch { return false; }
}

export function killAgent(tmuxSession: string): boolean {
  try {
    execSync(`tmux kill-session -t "${tmuxSession}"`, { stdio: 'pipe' });
    return true;
  } catch { return false; }
}

export function sessionExists(tmuxSession: string): boolean {
  try {
    execSync(`tmux has-session -t "${tmuxSession}" 2>/dev/null`, { stdio: 'pipe' });
    return true;
  } catch { return false; }
}

export function captureOutput(tmuxSession: string, lines: number = 50): string {
  try {
    return execSync(
      `tmux capture-pane -t "${tmuxSession}" -p -S -${lines}`,
      { stdio: 'pipe', encoding: 'utf-8', timeout: 5000 },
    ).trim();
  } catch { return ''; }
}

// --- Prompt builders ---

function buildPrompt(issueKey: string, userPrompt?: string): string {
  const parts = [
    `You are working on issue ${issueKey}.`,
    `Read the issue description and any comments for full context.`,
    `When done, write HANDOFF.md in this directory with: what you did, how to verify, and any concerns.`,
    `If you are suspended by the system, write SUSPEND.md with your current progress before exiting.`,
    `Then exit with /exit.`,
  ];
  if (userPrompt) parts.unshift(userPrompt);
  return parts.join('\n');
}

function buildSpawnScript(workDir: string, prompt: string, role: string, issueKey: string): string {
  const promptFile = `/tmp/anc-prompt-${role}-${issueKey}.txt`;
  writeFileSync(promptFile, prompt, 'utf-8');
  return `#!/bin/bash
cd "${workDir}" || exit 1
export AGENT_ROLE="${role}"
export ANC_ISSUE_KEY="${issueKey}"
export ANC_SERVER_URL="http://localhost:${process.env.ANC_WEBHOOK_PORT || 3849}"
claude --permission-mode auto -p "$(cat ${promptFile})"
`;
}
