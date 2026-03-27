/**
 * Runner — tmux process management, spawn, suspend, and session operations.
 *
 * Session resolution logic lives in ./resolve.ts.
 *
 * Hybrid model:
 *   First task:  claude --permission-mode auto -p "prompt"
 *   Follow-ups:  claude --permission-mode auto --continue -p "follow-up"
 *   Resume:      claude --permission-mode auto --continue -p "resume context"
 */

import { execSync } from 'child_process';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { AgentRole } from '../linear/types.js';
import { createLogger } from '../core/logger.js';

const log = createLogger('runner');

// --- Resolve tmux binary path at module load ---
// Bare `tmux` fails with ENOENT when ANC runs as a service without /opt/homebrew/bin in PATH.

function findTmux(): string {
  // 1. Try PATH first (works in interactive shells)
  try {
    return execSync('which tmux', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch { /* not in PATH */ }

  // 2. Check common locations (macOS Homebrew, Linux packages)
  const candidates = [
    '/opt/homebrew/bin/tmux',   // macOS ARM Homebrew
    '/usr/local/bin/tmux',      // macOS Intel Homebrew / manual
    '/usr/bin/tmux',            // Linux system package
    '/snap/bin/tmux',           // Linux snap
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }

  return ''; // empty = not found, checked at spawn time
}

const TMUX = findTmux();

/** Get the resolved tmux path. Throws if tmux was not found. */
export function getTmuxPath(): string {
  if (!TMUX) {
    throw new Error(
      'tmux not found. Install it (brew install tmux / apt install tmux) ' +
      'and ensure it is in PATH or at a standard location.',
    );
  }
  return TMUX;
}
import {
  ensureWorkspace, writePersonaToWorkspace, writeAutoModeSettings,
  getWorkspacePath,
} from './workspace.js';
import { buildPersona } from '../agents/persona.js';
import { bus } from '../bus.js';
import {
  trackSession, getSessionForIssue, markSuspended,
} from './health.js';

// Re-export resolveSession + ResolveResult from their new home for backwards compat
export { resolveSession, type ResolveResult } from './resolve.js';

// --- Spawn ---

export interface SpawnInternalOpts {
  role: AgentRole;
  issueKey: string;
  prompt?: string;
  useContinue: boolean;
  ceoAssigned?: boolean;
  priority?: number;
  isDuty?: boolean;
}

export function spawnClaude(opts: SpawnInternalOpts): { success: boolean; tmuxSession: string; error?: string } {
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
  const tmux = getTmuxPath();
  try { execSync(`${tmux} kill-session -t "${tmuxSession}" 2>/dev/null`, { stdio: 'pipe' }); } catch { /**/ }

  // Spawn
  try {
    execSync(
      `${tmux} new-session -d -s "${tmuxSession}" -c "${workspace.root}" "bash ${scriptPath}"`,
      { stdio: 'pipe', timeout: 10_000 },
    );

    log.info(`${useContinue ? 'Resumed' : 'Spawned'} ${role} on ${issueKey}`, { role, issueKey });

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
    log.error(`Spawn failed: ${error}`, { role, issueKey });
    bus.emit('agent:failed', { role, issueKey, error });
    return { success: false, tmuxSession, error };
  }
}

/** Move issue to In Progress + set agent as delegate on Linear */
async function setIssueInProgress(role: string, issueKey: string): Promise<void> {
  if (issueKey.startsWith('pulse-') || issueKey.startsWith('postmortem-')) return;

  try {
    const { getIssue, setIssueStatus } = await import('../linear/client.js');
    const { getAgent } = await import('../agents/registry.js');
    const issue = await getIssue(issueKey);
    if (!issue) return;

    // Set status to In Progress
    await setIssueStatus(issue.id, 'In Progress', role);

    // NOTE: We do NOT set delegateId. Setting it triggers Linear to auto-create
    // an AgentSession that we can't reliably dismiss, causing "Did not respond".
    // Agent identity is visible through the "picked up this issue" comment.
    log.debug(`${issueKey} → In Progress`, { issueKey });
  } catch (err) {
    log.error(`Failed to set In Progress: ${(err as Error).message}`, { issueKey });
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
    const tmux = getTmuxPath();
    const escaped = message.replace(/'/g, "'\\''");
    execSync(`${tmux} send-keys -t "${tmuxSession}" '${escaped}' Enter`, { stdio: 'pipe', timeout: 5000 });
    return true;
  } catch { return false; }
}

export function killAgent(tmuxSession: string): boolean {
  try {
    execSync(`${getTmuxPath()} kill-session -t "${tmuxSession}"`, { stdio: 'pipe' });
    return true;
  } catch { return false; }
}

export function sessionExists(tmuxSession: string): boolean {
  try {
    execSync(`${getTmuxPath()} has-session -t "${tmuxSession}" 2>/dev/null`, { stdio: 'pipe' });
    return true;
  } catch { return false; }
}

export function captureOutput(tmuxSession: string, lines: number = 50): string {
  try {
    return execSync(
      `${getTmuxPath()} capture-pane -t "${tmuxSession}" -p -S -${lines}`,
      { stdio: 'pipe', encoding: 'utf-8', timeout: 5000 },
    ).trim();
  } catch { return ''; }
}

/** Scan for existing anc-* tmux sessions on startup and reconstruct registry. */
export function recoverSessionsFromTmux(): number {
  try {
    const tmux = getTmuxPath();
    const output = execSync(`${tmux} list-sessions -F "#{session_name}" 2>/dev/null`, { encoding: 'utf-8' });
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

  // Capture current PATH so spawned tmux sessions can find claude and other tools.
  // Without this, service-launched ANC processes inherit a minimal PATH that
  // lacks /opt/homebrew/bin, /usr/local/bin, ~/.local/bin, etc.
  const currentPath = process.env.PATH || '/usr/bin:/bin';

  return `#!/bin/bash
cd "${workDir}" || exit 1

# Ensure tools (claude, node, git, etc.) are findable inside tmux
export PATH="${currentPath}"

# Prevent Claude nesting detection
unset CLAUDE_CODE CLAUDECODE CLAUDE_CODE_ENTRYPOINT

export AGENT_ROLE="${role}"
export ANC_ISSUE_KEY="${issueKey}"
export ANC_WORKSPACE_ROOT="${workDir}"
export ANC_SERVER_URL="http://localhost:${process.env.ANC_WEBHOOK_PORT || 3849}"
${tokenLine}
# Read prompt from file (avoids shell quoting issues with special characters)
PROMPT=$(cat "${promptFile}")
claude --permission-mode auto${continueFlag} -p "$PROMPT"
`;
}
