/**
 * Runner — spawns agent processes in tmux sessions.
 * Handles persona injection, workspace setup, and process lifecycle.
 */

import { execSync } from 'child_process';
import { writeFileSync } from 'fs';
import { join } from 'path';
import chalk from 'chalk';
import type { AgentRole } from '../linear/types.js';
import { ensureWorkspace, writePersonaToWorkspace, writeAutoModeSettings, type WorkspaceInfo } from './workspace.js';
import { buildPersona } from '../agents/persona.js';
import { bus } from '../bus.js';
import { trackSession, type TrackedSession } from './health.js';

export interface SpawnOptions {
  role: AgentRole;
  issueKey: string;
  prompt?: string;
  repoPath?: string;   // for code tasks: path to git repo
}

export interface SpawnResult {
  tmuxSession: string;
  workspace: WorkspaceInfo;
  success: boolean;
  error?: string;
}

/** Spawn an agent in a tmux session */
export function spawnAgent(opts: SpawnOptions): SpawnResult {
  const { role, issueKey, prompt, repoPath } = opts;
  const tmuxSession = `anc-${role}-${issueKey}`;

  // 1. Prepare workspace
  const workspace = ensureWorkspace(issueKey, role);

  // 2. Write persona
  const persona = buildPersona(role);
  writePersonaToWorkspace(workspace, persona);
  writeAutoModeSettings(workspace);

  // 3. Build the Claude Code command
  const workDir = repoPath ? workspace.codeDir : workspace.root;
  const promptArg = buildPrompt(issueKey, prompt);

  // Write command to a script file (avoids shell escaping hell)
  const scriptPath = `/tmp/anc-spawn-${tmuxSession}.sh`;
  const script = buildSpawnScript(workDir, promptArg, role, issueKey);
  writeFileSync(scriptPath, script, { mode: 0o755 });

  // 4. Kill existing session if any
  try {
    execSync(`tmux kill-session -t "${tmuxSession}" 2>/dev/null`, { stdio: 'pipe' });
  } catch { /* no existing session */ }

  // 5. Spawn tmux session
  try {
    execSync(
      `tmux new-session -d -s "${tmuxSession}" -c "${workDir}" "bash ${scriptPath}"`,
      { stdio: 'pipe', timeout: 10_000 },
    );

    console.log(chalk.green(`[runner] Spawned ${role} on ${issueKey} (tmux: ${tmuxSession})`));

    // Track for health monitoring
    trackSession({ role, issueKey, tmuxSession, spawnedAt: Date.now() });

    bus.emit('agent:spawned', { role, issueKey, tmuxSession });

    return { tmuxSession, workspace, success: true };
  } catch (err) {
    const error = (err as Error).message;
    console.error(chalk.red(`[runner] Failed to spawn ${role}: ${error}`));
    bus.emit('agent:failed', { role, issueKey, error });
    return { tmuxSession, workspace, success: false, error };
  }
}

/** Send a message to a running agent session */
export function sendToAgent(tmuxSession: string, message: string): boolean {
  try {
    // Use tmux send-keys to inject text
    const escaped = message.replace(/'/g, "'\\''");
    execSync(`tmux send-keys -t "${tmuxSession}" '${escaped}' Enter`, { stdio: 'pipe', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/** Kill an agent session */
export function killAgent(tmuxSession: string): boolean {
  try {
    execSync(`tmux kill-session -t "${tmuxSession}"`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/** Check if a tmux session exists */
export function sessionExists(tmuxSession: string): boolean {
  try {
    execSync(`tmux has-session -t "${tmuxSession}" 2>/dev/null`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/** Capture recent output from a tmux session */
export function captureOutput(tmuxSession: string, lines: number = 50): string {
  try {
    return execSync(
      `tmux capture-pane -t "${tmuxSession}" -p -S -${lines}`,
      { stdio: 'pipe', encoding: 'utf-8', timeout: 5000 },
    ).trim();
  } catch {
    return '';
  }
}

// --- Internal helpers ---

function buildPrompt(issueKey: string, userPrompt?: string): string {
  const parts = [
    `You are working on issue ${issueKey}.`,
    `Read the issue description and any comments for full context.`,
    `When done, write HANDOFF.md in this directory with: what you did, how to verify, and any concerns.`,
    `Then exit with /exit.`,
  ];
  if (userPrompt) {
    parts.unshift(userPrompt);
  }
  return parts.join('\n');
}

function buildSpawnScript(workDir: string, prompt: string, role: string, issueKey: string): string {
  // Write prompt to a file to avoid shell escaping entirely
  const promptFile = `/tmp/anc-prompt-${role}-${issueKey}.txt`;
  writeFileSync(promptFile, prompt, 'utf-8');

  return `#!/bin/bash
cd "${workDir}" || exit 1
export AGENT_ROLE="${role}"
export ANC_ISSUE_KEY="${issueKey}"
export ANC_SERVER_URL="http://localhost:${process.env.ANC_WEBHOOK_PORT || 3849}"

# Run Claude Code in auto mode with the prompt
claude --permission-mode auto -p "$(cat ${promptFile})"
`;
}
