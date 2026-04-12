/**
 * Per-issue workspace isolation.
 * Every issue gets its own directory. No sharing. No contamination.
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { getConfig, type AgentRole } from '../linear/types.js';

// Resolve ANC project root from this file's location (src/runtime/ → project root)
const __filename = fileURLToPath(import.meta.url);
const ANC_ROOT = join(dirname(__filename), '..', '..');

export interface WorkspaceInfo {
  root: string;         // ~/anc-workspaces/RYA-232/
  ancDir: string;       // ~/anc-workspaces/RYA-232/.anc/
  codeDir: string;      // ~/anc-workspaces/RYA-232/code/ (git worktree or symlink)
  claudeDir: string;    // ~/anc-workspaces/RYA-232/.claude/
  memoryDir: string;    // ~/anc-workspaces/RYA-232/.agent-memory/
  handoffPath: string;  // ~/anc-workspaces/RYA-232/HANDOFF.md
}

/** Create or get workspace for an issue */
export function ensureWorkspace(issueKey: string, agentRole: AgentRole): WorkspaceInfo {
  const config = getConfig();
  const root = join(config.workspaceBase, issueKey);
  const ancDir = join(root, '.anc');
  const codeDir = join(root, 'code');
  const claudeDir = join(root, '.claude');
  const memoryDir = join(root, '.agent-memory');
  const handoffPath = join(root, 'HANDOFF.md');

  // Create directories
  mkdirSync(ancDir, { recursive: true });
  mkdirSync(claudeDir, { recursive: true });

  // Symlink agent memory
  const agentMemDir = join(config.stateDir, 'agents', agentRole, 'memory');
  mkdirSync(agentMemDir, { recursive: true });
  if (!existsSync(memoryDir)) {
    try {
      symlinkSync(agentMemDir, memoryDir);
    } catch {
      // symlink might already exist or fail on some systems
    }
  }

  return { root, ancDir, codeDir, claudeDir, memoryDir, handoffPath };
}

/** Set up a git worktree for code tasks */
export function setupCodeWorktree(workspace: WorkspaceInfo, repoPath: string, branch?: string): boolean {
  if (existsSync(workspace.codeDir)) return true;

  try {
    const branchArg = branch ? `-b ${branch}` : '--detach';
    execSync(`git -C "${repoPath}" worktree add "${workspace.codeDir}" ${branchArg}`, {
      stdio: 'pipe',
      timeout: 30_000,
    });
    return true;
  } catch (err) {
    // Worktree creation failed — will fall back to symlink

    // Fallback: symlink to repo
    try {
      symlinkSync(repoPath, workspace.codeDir);
      return true;
    } catch {
      return false;
    }
  }
}

/** Write persona CLAUDE.md into the workspace */
export function writePersonaToWorkspace(workspace: WorkspaceInfo, persona: string): void {
  writeFileSync(join(workspace.claudeDir, 'CLAUDE.md'), persona, 'utf-8');
}

// -- Wave 2B: optional hook config for Claude Code process capture --
export interface ProcessCaptureHookConfig {
  taskId: string;
  role: string;
  hookUrl: string;   // e.g. http://localhost:3849/api/v1/hooks/<taskId>/event
  hookToken: string; // shared secret matching ANC_HOOK_TOKEN
}

/** Write Claude Code auto-mode settings.
 *  NO Linear MCP — agents must use `anc` CLI for all Linear operations.
 *  This prevents identity leaks (MCP uses CEO's global token).
 *
 *  Wave 2B: when `hookConfig` is provided, also registers PreToolUse,
 *  PostToolUse, UserPromptSubmit, Stop, and SessionEnd hooks that POST
 *  the raw event JSON to ANC's local hook endpoint for process capture. */
export function writeAutoModeSettings(
  workspace: WorkspaceInfo,
  _agentToken?: string,
  hookConfig?: ProcessCaptureHookConfig,
): void {
  // Resolve hook script path from project root (deterministic, not cwd-dependent)
  const hookScript = join(ANC_ROOT, 'hooks', 'plan-guard.sh');

  const settings: Record<string, unknown> = {
    permissions: {
      allow: [
        'Bash(*)','Read(*)','Write(*)','Edit(*)','Glob(*)','Grep(*)',
        'WebFetch(*)','WebSearch(*)','Agent(*)','Skill(*)',
      ],
      deny: [
        // Block Linear MCP tools — forces agents to use `anc` CLI which has correct identity
        'mcp__claude_ai_Linear__*',
      ],
    },
  };

  // Existing PostToolUse Bash plan-guard hook (always on).
  const baseHooks: Record<string, Array<Record<string, unknown>>> = {
    PostToolUse: [{
      matcher: 'Bash',
      hooks: [{ type: 'command', command: hookScript }],
    }],
  };

  if (hookConfig) {
    // -- Wave 2B: register process-capture hooks --
    // Each hook curl-POSTs the JSON payload Claude sends on stdin to ANC's
    // local hook endpoint. --max-time keeps a slow ANC from blocking the agent.
    const captureCmd =
      `cat | /usr/bin/curl -sS -X POST "${hookConfig.hookUrl}" ` +
      `-H "Authorization: Bearer ${hookConfig.hookToken}" ` +
      `-H "X-ANC-Agent-Role: ${hookConfig.role}" ` +
      `-H "Content-Type: application/json" ` +
      `--data-binary @- ` +
      `--max-time 3 || true`;
    const captureHook = () => ({ type: 'command', command: captureCmd });

    baseHooks.PreToolUse = [{ matcher: '*', hooks: [captureHook()] }];
    // Append capture hook alongside existing PostToolUse Bash entry.
    baseHooks.PostToolUse.push({ matcher: '*', hooks: [captureHook()] });
    baseHooks.UserPromptSubmit = [{ hooks: [captureHook()] }];
    baseHooks.Stop = [{ hooks: [captureHook()] }];
    baseHooks.SessionEnd = [{ hooks: [captureHook()] }];
    baseHooks.Notification = [{ hooks: [captureHook()] }];
  }

  settings.hooks = baseHooks;

  writeFileSync(
    join(workspace.claudeDir, 'settings.local.json'),
    JSON.stringify(settings, null, 2),
    'utf-8',
  );
}

/** Check if HANDOFF.md exists in workspace */
export function hasHandoff(workspace: WorkspaceInfo): boolean {
  return existsSync(workspace.handoffPath);
}

/** Read HANDOFF.md content */
export function readHandoff(workspace: WorkspaceInfo): string | null {
  if (!hasHandoff(workspace)) return null;
  return readFileSync(workspace.handoffPath, 'utf-8');
}

/** Clean up workspace (remove worktree, etc.) */
export function cleanupWorkspace(issueKey: string, repoPath?: string): void {
  const config = getConfig();
  const root = join(config.workspaceBase, issueKey);
  const codeDir = join(root, 'code');

  // Remove git worktree if it exists
  if (repoPath && existsSync(codeDir)) {
    try {
      execSync(`git -C "${repoPath}" worktree remove "${codeDir}" --force`, { stdio: 'pipe' });
    } catch { /* ignore */ }
  }
}

/** Get workspace path for an issue (without creating) */
export function getWorkspacePath(issueKey: string): string {
  return join(getConfig().workspaceBase, issueKey);
}
