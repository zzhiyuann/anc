/**
 * Workspace Bootstrap — pre-populates agent workspaces with repo code.
 *
 * For fair evaluation, every condition (including vanilla baseline) must
 * start from the same codebase state. This module:
 *
 *   1. Maintains a bare-clone cache at ~/anc-eval-repos/<owner>__<repo>/
 *   2. Creates a fresh checkout at the correct commit in the workspace dir
 *   3. Cleans up workspaces between conditions to prevent contamination
 */

import { execSync } from 'child_process';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const REPO_CACHE = join(homedir(), 'anc-eval-repos');
const WORKSPACE_BASE = process.env.ANC_WORKSPACE_BASE || join(homedir(), 'anc-workspaces');

/**
 * Ensure a bare clone of a repo exists in the cache.
 * Returns the path to the bare repo.
 */
export function ensureRepoCache(repo: string): string {
  mkdirSync(REPO_CACHE, { recursive: true });
  const cacheKey = repo.replace('/', '__');
  const cachePath = join(REPO_CACHE, cacheKey);

  if (existsSync(cachePath)) {
    // Fetch latest (best-effort, don't fail if offline)
    try {
      execSync(`git -C "${cachePath}" fetch --quiet 2>/dev/null`, {
        timeout: 60_000, stdio: 'pipe',
      });
    } catch { /* offline is fine for eval */ }
    return cachePath;
  }

  console.log(`    [bootstrap] Cloning ${repo} (bare) → ${cachePath}`);
  execSync(
    `git clone --bare "https://github.com/${repo}.git" "${cachePath}"`,
    { timeout: 300_000, stdio: 'pipe' },
  );
  return cachePath;
}

/**
 * Bootstrap a workspace with repo code at a specific commit.
 *
 * Creates a fresh checkout in ~/anc-workspaces/<taskId>/ so the agent
 * can work directly in the repo. ANC's ensureWorkspace() will later add
 * .claude/, .anc/, .agent-memory/ as subdirectories — these don't conflict
 * with repo files.
 *
 * @param taskId - The ANC task ID (used as workspace directory name)
 * @param repo - GitHub repo in "owner/repo" format
 * @param commit - Git commit hash to checkout (optional, defaults to HEAD)
 * @returns Path to the bootstrapped workspace
 */
export function bootstrapWorkspace(
  taskId: string,
  repo: string,
  commit?: string,
): string {
  const wsDir = join(WORKSPACE_BASE, taskId);

  // If workspace already has a .git, it's already bootstrapped
  if (existsSync(join(wsDir, '.git'))) {
    return wsDir;
  }

  // Ensure repo is cached
  const cachePath = ensureRepoCache(repo);

  // Create workspace as a fresh clone from cache
  mkdirSync(wsDir, { recursive: true });

  if (commit) {
    // Clone from cache at specific commit (shallow for speed)
    execSync(
      `git clone "${cachePath}" "${wsDir}" --no-checkout --quiet`,
      { timeout: 120_000, stdio: 'pipe' },
    );
    execSync(
      `git -C "${wsDir}" checkout "${commit}" --quiet`,
      { timeout: 30_000, stdio: 'pipe' },
    );
  } else {
    // Clone from cache at HEAD
    execSync(
      `git clone "${cachePath}" "${wsDir}" --depth 1 --quiet`,
      { timeout: 120_000, stdio: 'pipe' },
    );
  }

  console.log(`    [bootstrap] Workspace ready: ${wsDir} @ ${commit?.slice(0, 8) || 'HEAD'}`);
  return wsDir;
}

/**
 * Clean up a single workspace (remove all files, ready for next condition).
 */
export function cleanWorkspace(taskId: string): void {
  const wsDir = join(WORKSPACE_BASE, taskId);
  if (existsSync(wsDir)) {
    rmSync(wsDir, { recursive: true, force: true });
  }
}

/**
 * Clean up all eval workspaces (between conditions).
 * Only removes workspaces matching eval task IDs, not user workspaces.
 */
export function cleanAllEvalWorkspaces(taskIds: string[]): void {
  for (const id of taskIds) {
    cleanWorkspace(id);
  }
}

/**
 * Pre-clone all repos needed for a set of tasks.
 * Run this once before the experiment to avoid clone delays during runs.
 */
export function precacheRepos(tasks: Array<{ repo: string }>): void {
  const repos = Array.from(new Set(tasks.map(t => t.repo)));
  console.log(`[bootstrap] Pre-caching ${repos.length} repos...`);
  for (const repo of repos) {
    try {
      ensureRepoCache(repo);
      console.log(`  ✓ ${repo}`);
    } catch (e: any) {
      console.error(`  ✗ ${repo}: ${e.message}`);
    }
  }
}
