/**
 * Runner — the universal session resolution gate + tmux process management.
 *
 * ALL trigger paths (webhook, comment, session, discord, queue) call resolveSession().
 * It handles: dedup, reactivation, resume, spawn, capacity, circuit breaker.
 *
 * Hybrid model:
 *   First task:  claude --permission-mode auto -p "prompt"
 *   Follow-ups:  claude --permission-mode auto --continue -p "follow-up"
 *   Resume:      claude --permission-mode auto --continue -p "resume context"
 */

import { execSync } from 'child_process';
import { writeFileSync, readFileSync, existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import chalk from 'chalk';
import type { AgentRole } from '../linear/types.js';
import {
  ensureWorkspace, writePersonaToWorkspace, writeAutoModeSettings,
  type WorkspaceInfo, getWorkspacePath,
} from './workspace.js';
import { buildPersona } from '../agents/persona.js';
import { bus } from '../bus.js';
import {
  trackSession, untrackSession, markIdle, markActiveFromIdle,
  markSuspended, markResumed, hasCapacity, hasDutyCapacity, pickToEvict,
  getSessionForIssue, isIssueIdle, isIssueSuspended,
} from './health.js';
import { isBreakerTripped, recordFailure, recordSuccess } from './circuit-breaker.js';
import { enqueue } from '../routing/queue.js';

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
    console.log(chalk.dim(`[resolve] ${issueKey}: breaker tripped (${Math.round(tripped / 1000)}s remaining)`));
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
        console.log(chalk.dim(`[resolve] Evicting idle ${victim.role}/${victim.issueKey}`));
        untrackSession(victim.issueKey);
      } else {
        // Active session: needs suspend protocol
        console.log(chalk.yellow(`[resolve] Suspending ${victim.role}/${victim.issueKey} for ${issueKey}`));
        suspendSession(victim.issueKey);
      }
    } else {
      // All sessions protected — queue
      enqueue({ issueKey, issueId: '', agentRole: role, priority: priority ?? 3, context: prompt });
      return { action: 'queued' };
    }
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

// --- Internal spawn ---

interface SpawnInternalOpts {
  role: AgentRole;
  issueKey: string;
  prompt?: string;
  useContinue: boolean;
  ceoAssigned?: boolean;
  priority?: number;
  isDuty?: boolean;
}

function spawnClaude(opts: SpawnInternalOpts): { success: boolean; tmuxSession: string; error?: string } {
  const { role, issueKey, prompt, useContinue, ceoAssigned, priority, isDuty } = opts;
  const tmuxSession = `anc-${role}-${issueKey}`;

  // Prepare workspace + persona
  const workspace = ensureWorkspace(issueKey, role);
  const tokenPath = join(homedir(), '.anc', 'agents', role, '.oauth-token');
  const agentToken = existsSync(tokenPath) ? readFileSync(tokenPath, 'utf-8').trim() : undefined;
  if (!useContinue) {
    const persona = buildPersona(role);
    writePersonaToWorkspace(workspace, persona);
  }
  // Always write settings (may have updated MCP config)
  writeAutoModeSettings(workspace, agentToken);

  // Build prompt
  const fullPrompt = prompt ?? buildDefaultPrompt(issueKey);

  // Write script
  const scriptPath = `/tmp/anc-spawn-${tmuxSession}.sh`;
  writeFileSync(scriptPath, _buildSpawnScript(workspace.root, fullPrompt, role, issueKey, useContinue), { mode: 0o755 });

  // Kill stale tmux
  try { execSync(`tmux kill-session -t "${tmuxSession}" 2>/dev/null`, { stdio: 'pipe' }); } catch { /**/ }

  // Spawn
  try {
    execSync(
      `tmux new-session -d -s "${tmuxSession}" -c "${workspace.root}" "bash ${scriptPath}"`,
      { stdio: 'pipe', timeout: 10_000 },
    );

    console.log(chalk.green(`[runner] ${useContinue ? 'Resumed' : 'Spawned'} ${role} on ${issueKey}`));

    trackSession({
      role, issueKey, tmuxSession, spawnedAt: Date.now(),
      priority: priority ?? 3,
      ceoAssigned: ceoAssigned ?? false,
      useContinue,
      isDuty: isDuty ?? false,
    });

    bus.emit('agent:spawned', { role, issueKey, tmuxSession });

    // Set status to In Progress + assign delegate on Linear (async, non-blocking)
    setIssueInProgress(role, issueKey).catch(() => {});

    return { success: true, tmuxSession };
  } catch (err) {
    const error = (err as Error).message;
    console.error(chalk.red(`[runner] Spawn failed: ${error}`));
    bus.emit('agent:failed', { role, issueKey, error });
    return { success: false, tmuxSession, error };
  }
}

/** Move issue to In Progress on Linear when agent starts working */
async function setIssueInProgress(role: string, issueKey: string): Promise<void> {
  // Skip duty sessions (pulse, postmortem — they don't have real Linear issues)
  if (issueKey.startsWith('pulse-') || issueKey.startsWith('postmortem-')) return;

  try {
    const { getIssue, setIssueStatus } = await import('../linear/client.js');
    const issue = await getIssue(issueKey);
    if (!issue) return;

    await setIssueStatus(issue.id, 'In Progress');
    console.log(chalk.dim(`[runner] ${issueKey} → In Progress`));
  } catch (err) {
    console.error(chalk.dim(`[runner] Failed to set In Progress: ${(err as Error).message}`));
  }
}

// --- Suspend ---

export function suspendSession(issueKey: string): boolean {
  const session = getSessionForIssue(issueKey);
  if (!session || session.state !== 'active') return false;

  const workspace = getWorkspacePath(issueKey);
  const suspendPath = join(workspace, 'SUSPEND.md');

  // Try graceful checkpoint
  if (sessionExists(session.tmuxSession)) {
    try {
      sendToAgent(session.tmuxSession,
        'SYSTEM: Suspending. Write SUSPEND.md with progress + next steps, then /exit.'
      );
      execSync('sleep 3', { stdio: 'pipe' });
    } catch { /**/ }
  }

  if (!existsSync(suspendPath)) {
    writeFileSync(suspendPath, `# Suspended\n\nAuto-suspended at ${new Date().toISOString()}.\n`, 'utf-8');
  }

  killAgent(session.tmuxSession);
  markSuspended(issueKey);
  bus.emit('agent:suspended', { role: session.role, issueKey, reason: 'capacity' });
  return true;
}

// --- Basic tmux operations ---

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

/** Scan for existing anc-* tmux sessions on startup and reconstruct registry. */
export function recoverSessionsFromTmux(): number {
  try {
    const output = execSync('tmux list-sessions -F "#{session_name}" 2>/dev/null', { encoding: 'utf-8' });
    const tmuxSessions = output.split('\n').filter(s => s.startsWith('anc-'));
    let count = 0;
    for (const tmux of tmuxSessions) {
      const match = tmux.match(/^anc-(\w+)-(.+)$/);
      if (!match) continue;
      const [, role, ik] = match;
      if (getSessionForIssue(ik)) continue;
      trackSession({ role, issueKey: ik, tmuxSession: tmux, spawnedAt: Date.now(), priority: 3, ceoAssigned: false, useContinue: true });
      count++;
    }
    return count;
  } catch { return 0; }
}

// --- Prompt / script builders ---

function buildDefaultPrompt(issueKey: string): string {
  return [
    `You are working on issue ${issueKey}.`,
    `Read the issue description and comments for full context.`,
    `When you complete meaningful work, write HANDOFF.md. For conversations/questions, just answer directly.`,
  ].join('\n');
}

/** @internal Exported for testing */
export function _buildSpawnScript(workDir: string, prompt: string, role: string, issueKey: string, useContinue: boolean): string {
  const promptFile = `/tmp/anc-prompt-${role}-${issueKey}.txt`;
  writeFileSync(promptFile, prompt, 'utf-8');
  const continueFlag = useContinue ? ' --continue' : '';

  // Load agent OAuth token so the claude session posts as the agent, not CEO
  const tokenPath = join(homedir(), '.anc', 'agents', role, '.oauth-token');
  const tokenLine = existsSync(tokenPath)
    ? `export ANC_AGENT_TOKEN="Bearer $(cat ${tokenPath})"`
    : '# No agent OAuth token — will use CEO identity';

  return `#!/bin/bash
cd "${workDir}" || exit 1

# Prevent Claude nesting detection
unset CLAUDE_CODE CLAUDECODE CLAUDE_CODE_ENTRYPOINT

export AGENT_ROLE="${role}"
export ANC_ISSUE_KEY="${issueKey}"
export ANC_SERVER_URL="http://localhost:${process.env.ANC_WEBHOOK_PORT || 3849}"
${tokenLine}
claude --permission-mode auto${continueFlag} -p "$(cat ${promptFile})"
`;
}
