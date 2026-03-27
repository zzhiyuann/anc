/**
 * Per-issue workspace isolation.
 * Every issue gets its own directory. No sharing. No contamination.
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, rmSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import { getConfig, type AgentRole } from '../linear/types.js';

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
    console.error(`[workspace] Failed to create worktree:`, (err as Error).message);
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

/** Write Claude Code auto-mode settings + Linear MCP */
export function writeAutoModeSettings(workspace: WorkspaceInfo, agentToken?: string): void {
  const settings: Record<string, unknown> = {
    permissions: {
      allow: [
        'Bash(*)','Read(*)','Write(*)','Edit(*)','Glob(*)','Grep(*)',
        'WebFetch(*)','WebSearch(*)','Agent(*)','Skill(*)',
        'mcp__claude_ai_Linear__list_issues(*)',
        'mcp__claude_ai_Linear__get_issue(*)',
        'mcp__claude_ai_Linear__list_comments(*)',
        'mcp__claude_ai_Linear__save_comment(*)',
        'mcp__claude_ai_Linear__save_issue(*)',
        'mcp__claude_ai_Linear__search_documentation(*)',
      ],
      deny: [],
    },
  };

  // Add Linear MCP server config if agent has a token
  if (agentToken) {
    settings.mcpServers = {
      linear: {
        command: 'npx',
        args: ['-y', 'mcp-remote', 'https://mcp.linear.app/mcp'],
        env: {
          LINEAR_API_KEY: agentToken.replace('Bearer ', ''),
        },
      },
    };
  }

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
