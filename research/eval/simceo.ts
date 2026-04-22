#!/usr/bin/env npx tsx
/**
 * SimCEO — Simulated CEO for evaluating ANC organizational design patterns.
 *
 * Uses `claude --print` (Claude Code CLI) to simulate a human CEO who:
 * 1. Issues realistic tasks
 * 2. Reviews agent outputs with domain-informed criteria
 * 3. Provides mid-task feedback (follow-up comments)
 * 4. Rates satisfaction (1-5 scale, aligned with PULSE framework)
 *
 * No API key needed — runs via local Claude Code CLI.
 */

import { execSync, spawn, ChildProcess } from 'child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, renameSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { bootstrapWorkspace, cleanWorkspace } from './workspace-bootstrap.js';

// --- Types ---

interface TaskSpec {
  id: string;
  title: string;
  description: string;
  repo: string;
  expected_labels: string[];
  complexity: 'low' | 'medium' | 'high';
  source: 'github' | 'swebench' | 'custom';
  ground_truth?: string; // known-good diff
  base_commit?: string;  // git commit to checkout (SWE-bench)
}

interface SimCEORating {
  task_id: string;
  satisfaction: number; // 1-5 (aligned with PULSE)
  task_completion: number; // 0-1 binary
  code_quality: number; // 1-5
  communication_quality: number; // 1-5 (how well agent reported progress)
  autonomy_score: number; // 1-5 (how little CEO intervention needed)
  recovery_needed: boolean;
  ceo_interventions: number;
  rationale: string;
  timestamp: string;
}

interface AblationCondition {
  name: string;
  memory: 'none' | 'flat' | 'full'; // no memory | memory without retros | memory + retros
  ceo_office: boolean;
  review_policy: 'strict' | 'normal' | 'lax' | 'autonomous';
}

interface ExperimentResult {
  condition: AblationCondition;
  task: TaskSpec;
  rating: SimCEORating;
  duration_ms: number;
  cost_usd: number;
  tokens_used: number;
}

// --- Config ---

import { fileURLToPath } from 'url';
import { dirname } from 'path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const RESULTS_DIR = join(__dirname, '..', 'results');
const DATA_DIR = join(__dirname, '..', 'data');
const ANC_ROOT = join(__dirname, '..', '..');

// --- Claude CLI wrapper ---

export function claudePrint(prompt: string, maxTokens = 4096): string {
  const escapedPrompt = prompt.replace(/'/g, "'\\''");
  try {
    const result = execSync(
      `claude -p '${escapedPrompt}'`,
      {
        encoding: 'utf-8',
        timeout: 600_000, // 10 min for complex tasks
        maxBuffer: 10 * 1024 * 1024,
        cwd: ANC_ROOT,
      }
    );
    return result.trim();
  } catch (e: any) {
    console.error('[SimCEO] claude --print failed:', e.message);
    return '';
  }
}

// --- SimCEO Core ---

const SIMCEO_SYSTEM_PROMPT = `You are a simulated CEO of a one-person AI company. You use ANC (Agent Native Company) to manage a team of AI agents: Engineer, Strategist, Ops, and CEO Office.

Your behavior:
- You create tasks with clear descriptions and acceptance criteria
- You review completed work critically but fairly
- You provide mid-task feedback when agents ask or seem stuck
- You rate agent performance on a 1-5 scale (1=terrible, 5=excellent)
- You value: code correctness, test coverage, clear communication, minimal need for your intervention
- You are busy — you prefer agents that work autonomously and only escalate real blockers

When rating, consider:
- Did the agent complete the task fully?
- Was the code correct and well-tested?
- Did the agent communicate clearly (HANDOFF.md, comments)?
- How many times did you need to intervene?
- Did the agent learn from past tasks (if memory is available)?

Respond in structured JSON only.`;

export function rateTaskOutput(
  task: TaskSpec,
  agentOutput: string,
  condition: AblationCondition,
  interactionLog: string[]
): SimCEORating {
  // BLIND EVALUATION: strip condition info from the rating prompt.
  // SimCEO should rate only the output quality, not be biased by knowing
  // whether the agent had memory/oversight/etc.
  const prompt = `${SIMCEO_SYSTEM_PROMPT}

You are evaluating an agent's work on a software engineering task.

Task: ${task.title}
Description: ${task.description}
Complexity: ${task.complexity}
${task.ground_truth ? `\nKnown correct approach (ground truth diff, first 1000 chars):\n${task.ground_truth.slice(0, 1000)}` : ''}

Agent output:
${agentOutput.slice(0, 8000)}

Interaction log (CEO-agent exchanges):
${interactionLog.join('\n').slice(0, 4000)}

Rate this output. If a ground truth diff is provided, check whether the agent's changes address the same root cause. Respond with ONLY valid JSON:
{
  "satisfaction": <1-5>,
  "task_completion": <0 or 1>,
  "code_quality": <1-5>,
  "communication_quality": <1-5>,
  "autonomy_score": <1-5>,
  "recovery_needed": <true/false>,
  "ceo_interventions": <number>,
  "rationale": "<2-3 sentences>"
}`;

  const response = claudePrint(prompt, 1024);

  try {
    // Strip markdown code fences if present
    let jsonStr = response;
    const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) jsonStr = fenceMatch[1].trim();

    const parsed = JSON.parse(jsonStr);
    return {
      task_id: task.id,
      ...parsed,
      timestamp: new Date().toISOString(),
    };
  } catch {
    console.error('[SimCEO] Failed to parse rating:', response);
    return {
      task_id: task.id,
      satisfaction: 0,
      task_completion: 0,
      code_quality: 0,
      communication_quality: 0,
      autonomy_score: 0,
      recovery_needed: false,
      ceo_interventions: 0,
      rationale: 'PARSE_ERROR: ' + response.slice(0, 200),
      timestamp: new Date().toISOString(),
    };
  }
}

export function generateFollowUp(
  task: TaskSpec,
  agentProgress: string,
  condition: AblationCondition
): string {
  const prompt = `${SIMCEO_SYSTEM_PROMPT}

An agent is working on this task:
Task: ${task.title}
Description: ${task.description}

Current progress (last output):
${agentProgress.slice(0, 4000)}

Conditions: memory=${condition.memory}, oversight=${condition.ceo_office}, review=${condition.review_policy}

As the CEO, decide: should you intervene? If yes, write a brief follow-up comment (1-2 sentences). If no, respond with "NO_INTERVENTION".

Respond with ONLY the comment text or "NO_INTERVENTION".`;

  return claudePrint(prompt, 256);
}

// --- Experiment runner ---

export async function runExperiment(
  tasks: TaskSpec[],
  condition: AblationCondition,
  outputDir: string
): Promise<ExperimentResult[]> {
  mkdirSync(outputDir, { recursive: true });
  const results: ExperimentResult[] = [];

  console.log(`\n[Experiment] Condition: ${condition.name}`);
  console.log(`  Memory: ${condition.memory}, CEO Office: ${condition.ceo_office}, Review: ${condition.review_policy}`);
  console.log(`  Tasks: ${tasks.length}\n`);

  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    console.log(`  [${i + 1}/${tasks.length}] ${task.title}`);

    const startTime = Date.now();

    // 1. Apply condition config to ANC
    applyCondition(condition);

    // 2. Run the task through ANC (or vanilla claude --print for baseline)
    const { output, interactionLog, tokens, cost } = await executeTask(task, condition);

    // 3. SimCEO rates the output
    const rating = rateTaskOutput(task, output, condition, interactionLog);

    const duration = Date.now() - startTime;

    const result: ExperimentResult = {
      condition,
      task,
      rating,
      duration_ms: duration,
      cost_usd: cost,
      tokens_used: tokens,
    };

    results.push(result);

    // Save incrementally
    writeFileSync(
      join(outputDir, `${task.id}_${condition.name}.json`),
      JSON.stringify(result, null, 2)
    );

    console.log(`    Satisfaction: ${rating.satisfaction}/5, Completion: ${rating.task_completion}, Duration: ${(duration / 1000).toFixed(0)}s`);
  }

  // Save full results
  writeFileSync(
    join(outputDir, `_results_${condition.name}.json`),
    JSON.stringify(results, null, 2)
  );

  return results;
}

// --- Condition application ---

function applyCondition(condition: AblationCondition) {
  // Modify ANC config files to match the condition
  const configDir = join(ANC_ROOT, 'config');

  // 1. Memory condition
  if (condition.memory === 'none') {
    // Set env var to disable memory loading
    process.env.ANC_MEMORY_DISABLED = 'true';
    process.env.ANC_RETROS_DISABLED = 'true';
  } else if (condition.memory === 'flat') {
    delete process.env.ANC_MEMORY_DISABLED;
    process.env.ANC_RETROS_DISABLED = 'true'; // memory but no retros
  } else {
    delete process.env.ANC_MEMORY_DISABLED;
    delete process.env.ANC_RETROS_DISABLED;
  }

  // 2. CEO Office condition
  if (!condition.ceo_office) {
    process.env.ANC_CEO_OFFICE_DISABLED = 'true';
  } else {
    delete process.env.ANC_CEO_OFFICE_DISABLED;
  }

  // 3. Review policy — write to review.yaml
  const reviewConfig = `default: ${condition.review_policy}\n\nroles:\n  engineer: ${condition.review_policy}\n  strategist: ${condition.review_policy}\n  ops: ${condition.review_policy}\n  ceo-office: autonomous\n`;

  writeFileSync(join(configDir, 'review.yaml'), reviewConfig);
}

// --- Task execution ---

interface TaskExecution {
  output: string;
  interactionLog: string[];
  tokens: number;
  cost: number;
}

// --- ANC Server Management ---

const ANC_PORT = Number(process.env.ANC_PORT || 3849);
const ANC_URL = `http://localhost:${ANC_PORT}`;
let ancServerProcess: ChildProcess | null = null;

function isAncServerRunning(): boolean {
  try {
    execSync(`curl -s -o /dev/null -w '%{http_code}' ${ANC_URL}/health`, {
      encoding: 'utf-8', timeout: 3_000,
    });
    return true;
  } catch {
    return false;
  }
}

function ensureAncServer(): void {
  if (isAncServerRunning()) {
    console.log('    [ANC] Server already running');
    return;
  }
  console.log('    [ANC] Starting server...');
  ancServerProcess = spawn('node', ['dist/index.js', 'serve', '--port', String(ANC_PORT)], {
    cwd: ANC_ROOT,
    env: {
      ...process.env,
      ANC_BUDGET_DISABLED: 'true',
      // Dummy Linear env vars (Linear integration not needed for eval)
      ANC_LINEAR_TEAM_ID: process.env.ANC_LINEAR_TEAM_ID || 'eval-dummy',
      ANC_LINEAR_API_KEY: process.env.ANC_LINEAR_API_KEY || 'eval-dummy',
      ANC_LINEAR_TEAM_KEY: process.env.ANC_LINEAR_TEAM_KEY || 'eval-dummy',
      ANC_LINEAR_WEBHOOK_SECRET: process.env.ANC_LINEAR_WEBHOOK_SECRET || 'eval-dummy',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  ancServerProcess.unref();

  // Wait for server to be ready (up to 15s)
  for (let i = 0; i < 30; i++) {
    try {
      execSync('sleep 0.5', { timeout: 2000 });
      if (isAncServerRunning()) {
        console.log('    [ANC] Server started');
        return;
      }
    } catch { /* keep waiting */ }
  }
  throw new Error('ANC server failed to start within 15s');
}

// --- Workspace output capture ---

/** Read HANDOFF.md from workspace (may exist even if not captured via API). */
function readWorkspaceHandoff(issueKey: string): string | null {
  const wsBase = process.env.ANC_WORKSPACE_BASE || join(homedir(), 'anc-workspaces');
  const wsDir = join(wsBase, issueKey);
  // Check for HANDOFF.md or archived HANDOFF-*.md
  if (existsSync(join(wsDir, 'HANDOFF.md'))) {
    return readFileSync(join(wsDir, 'HANDOFF.md'), 'utf-8');
  }
  // Check archived handoffs
  try {
    const files = readdirSync(wsDir).filter(f => f.startsWith('HANDOFF') && f.endsWith('.md')).sort();
    if (files.length > 0) {
      return readFileSync(join(wsDir, files[files.length - 1]), 'utf-8');
    }
  } catch { /* no workspace */ }
  return null;
}

/** Check if a tmux session is alive (direct check, bypasses ANC tracker). */
function isTmuxAlive(tmuxSession: string): boolean {
  try {
    execSync(`tmux has-session -t "${tmuxSession}" 2>/dev/null`, { timeout: 3_000 });
    return true;
  } catch {
    return false;
  }
}

/** Capture tmux pane content as last-resort output. */
function captureTmuxPane(tmuxSession: string): string | null {
  try {
    return execSync(
      `tmux capture-pane -t "${tmuxSession}" -p -S -200 2>/dev/null`,
      { encoding: 'utf-8', timeout: 5_000 }
    ).trim();
  } catch {
    return null;
  }
}

/** Check workspace for any changed files (git diff). */
function captureWorkspaceDiff(issueKey: string): string | null {
  const wsBase = process.env.ANC_WORKSPACE_BASE || join(homedir(), 'anc-workspaces');
  const wsDir = join(wsBase, issueKey);
  if (!existsSync(wsDir)) return null;
  try {
    const diff = execSync('git diff HEAD 2>/dev/null || git diff 2>/dev/null', {
      encoding: 'utf-8', timeout: 10_000, cwd: wsDir,
    }).trim();
    return diff || null;
  } catch { return null; }
}

async function executeTask(
  task: TaskSpec,
  condition: AblationCondition
): Promise<TaskExecution> {
  const interactionLog: string[] = [];

  // Generate a unique workspace ID per condition+task to avoid contamination
  const wsId = `eval-${condition.name}-${task.id}`.replace(/[^a-zA-Z0-9_-]/g, '-');

  // Bootstrap workspace with repo code (all conditions get the same starting state)
  if (task.repo) {
    try {
      cleanWorkspace(wsId);
      bootstrapWorkspace(wsId, task.repo, task.base_commit);
    } catch (e: any) {
      console.error(`    [bootstrap] Failed for ${task.repo}: ${e.message}`);
    }
  }

  const wsBase = process.env.ANC_WORKSPACE_BASE || join(homedir(), 'anc-workspaces');
  const wsDir = join(wsBase, wsId);

  if (condition.name === 'vanilla_baseline') {
    // Vanilla: run Claude interactively in the bootstrapped workspace (fair comparison).
    // Same code access as ANC conditions, no orchestration overhead.
    const vanillaPrompt = [
      `You are a software engineer. Complete this task:`,
      ``,
      `Title: ${task.title}`,
      `Description: ${task.description}`,
      ``,
      `You are working in a git checkout of ${task.repo}. Make your code changes directly.`,
      `When done, write HANDOFF.md with ## Summary and ## Verification sections.`,
      `Do NOT ask for confirmation. Just implement the fix and write HANDOFF.md.`,
    ].join('\n');

    const tmuxName = `eval-vanilla-${task.id}`.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 60);
    try {
      // Kill stale session
      try { execSync(`tmux kill-session -t "${tmuxName}" 2>/dev/null`, { stdio: 'pipe' }); } catch { /**/ }

      // Write prompt to file (avoids quoting issues)
      const promptPath = `/tmp/eval-prompt-${tmuxName}.txt`;
      writeFileSync(promptPath, vanillaPrompt);

      // Spawn Claude in the workspace
      const script = [
        `#!/bin/bash`,
        `cd "${wsDir}" || exit 1`,
        `export PATH="${join(homedir(), '.local', 'bin')}:/opt/homebrew/bin:/usr/local/bin:$PATH"`,
        `unset CLAUDE_CODE CLAUDECODE CLAUDE_CODE_ENTRYPOINT`,
        `PROMPT=$(cat "${promptPath}")`,
        `claude --dangerously-skip-permissions "$PROMPT"`,
      ].join('\n');
      const scriptPath = `/tmp/eval-spawn-${tmuxName}.sh`;
      writeFileSync(scriptPath, script, { mode: 0o755 });

      execSync(`tmux new-session -d -s "${tmuxName}" "bash ${scriptPath}"`, {
        stdio: 'pipe', timeout: 10_000,
      });
      // Auto-accept trust dialog
      setTimeout(() => {
        try { execSync(`tmux send-keys -t "${tmuxName}" Enter`, { stdio: 'pipe', timeout: 3000 }); } catch { /**/ }
      }, 2000);

      // Poll for completion (same as ANC path)
      let output = '';
      const maxWait = 1_800_000; // 30 min
      const pollInterval = 15_000;
      let elapsed = 0;

      while (elapsed < maxWait) {
        await sleep(pollInterval);
        elapsed += pollInterval;

        // Check if tmux died
        if (!isTmuxAlive(tmuxName)) {
          output = readWorkspaceHandoff(wsId) || '';
          if (!output) output = captureWorkspaceDiff(wsId) || '';
          if (!output) output = 'Agent completed without HANDOFF';
          console.log(`    [vanilla] Session ended (${elapsed / 1000}s)`);
          break;
        }

        // Check if HANDOFF.md appeared
        const handoff = readWorkspaceHandoff(wsId);
        if (handoff) {
          output = handoff;
          console.log(`    [vanilla] HANDOFF.md detected (${elapsed / 1000}s)`);
          // Let agent finish naturally, don't kill immediately
          await sleep(5_000);
          break;
        }

        if (elapsed % 60_000 === 0) {
          console.log(`    [vanilla] ... waiting ${elapsed / 1000}s`);
        }
      }

      if (!output) {
        output = readWorkspaceHandoff(wsId) || '';
        if (!output) output = captureTmuxPane(tmuxName) || '';
        if (!output) output = captureWorkspaceDiff(wsId) || '';
        output = output ? `TIMEOUT (partial): ${output}` : 'TIMEOUT: no output in 30min';
      }

      // Capture the git diff as supplementary output
      const diff = captureWorkspaceDiff(wsId);
      if (diff && !output.includes(diff)) {
        output += `\n\n--- Git Diff ---\n${diff.slice(0, 4000)}`;
      }

      // Kill tmux session
      try { execSync(`tmux kill-session -t "${tmuxName}" 2>/dev/null`, { stdio: 'pipe' }); } catch { /**/ }

      return { output, interactionLog: [], tokens: 0, cost: 0 };
    } catch (e: any) {
      console.error(`    [vanilla Error] ${e.message}`);
      return { output: 'EXECUTION_ERROR: ' + e.message, interactionLog, tokens: 0, cost: 0 };
    }
  }

  // ANC-managed execution via ANC server API
  // Flow: create task (no dispatch) → bootstrap workspace → dispatch → poll → capture
  try {
    ensureAncServer();

    // Append autonomy instruction so agent doesn't ask for confirmation
    const evalDescription = [
      task.description,
      '',
      '---',
      'IMPORTANT: You are running in autonomous evaluation mode.',
      `You are working in a git checkout of ${task.repo}.`,
      '- Do NOT ask for confirmation or permission — proceed with the best approach.',
      '- Make your code changes directly in the workspace.',
      '- When done, write HANDOFF.md with ## Summary and ## Verification sections.',
      '- Do NOT wait for human input. Just do the work and write HANDOFF.md.',
    ].join('\n');

    // Step 1: Create task without auto-dispatch
    const createBody = JSON.stringify({
      title: task.title,
      description: evalDescription,
      priority: task.complexity === 'high' ? 1 : task.complexity === 'medium' ? 2 : 3,
      noDispatch: true,
    });

    const createResp = execSync(
      `curl -s -X POST ${ANC_URL}/api/v1/tasks -H 'Content-Type: application/json' -d '${createBody.replace(/'/g, "'\\''")}'`,
      { encoding: 'utf-8', timeout: 10_000 }
    );
    const created = JSON.parse(createResp);
    const taskId = created.task?.id || created.id;
    console.log(`    [ANC] Created task ${taskId}`);

    // Step 2: Bootstrap workspace with repo code.
    // The dispatch endpoint uses issueKey = `${taskId}-engineer` for multi-agent
    // support, so the workspace will be at ~/anc-workspaces/<taskId>-engineer/.
    const dispatchIssueKey = `${taskId}-engineer`;
    if (task.repo) {
      try {
        cleanWorkspace(dispatchIssueKey);
        bootstrapWorkspace(dispatchIssueKey, task.repo, task.base_commit);
      } catch (e: any) {
        console.error(`    [bootstrap] Failed: ${e.message}`);
      }
    }

    // Step 3: Rename repo's own CLAUDE.md to avoid overriding ANC persona
    const wsBase2 = process.env.ANC_WORKSPACE_BASE || join(homedir(), 'anc-workspaces');
    const wsDir = join(wsBase2, dispatchIssueKey);
    const repoClaude = join(wsDir, 'CLAUDE.md');
    if (existsSync(repoClaude)) {
      const content = readFileSync(repoClaude, 'utf-8');
      // Only rename if it's the repo's CLAUDE.md (short), not ANC's persona (long)
      if (content.length < 500) {
        renameSync(repoClaude, join(wsDir, 'CLAUDE.repo.md'));
      }
    }

    // Step 4: Dispatch via separate API call — ANC will write full persona to .claude/CLAUDE.md
    const dispatchBody = JSON.stringify({ role: 'engineer' });
    const dispatchResp = execSync(
      `curl -s -X POST ${ANC_URL}/api/v1/tasks/${taskId}/dispatch -H 'Content-Type: application/json' -d '${dispatchBody}'`,
      { encoding: 'utf-8', timeout: 15_000 }
    );
    const dispatched = JSON.parse(dispatchResp);
    const tmuxSession = dispatched.session?.tmuxSession || `anc-engineer-${dispatchIssueKey}`;
    console.log(`    [ANC] Dispatched → ${tmuxSession}`);

    // Step 5: Ensure ANC persona is also at workspace root (Claude Code reads root CLAUDE.md)
    const ancPersonaPath = join(wsDir, '.claude', 'CLAUDE.md');
    if (existsSync(ancPersonaPath)) {
      const persona = readFileSync(ancPersonaPath, 'utf-8');
      writeFileSync(repoClaude, persona);
      console.log(`    [ANC] Persona copied to workspace root (${persona.split('\n').length} lines)`);
    }

    // Poll for completion
    let output = '';
    const maxWait = 1_800_000; // 30 min
    const pollInterval = 15_000; // 15s
    let elapsed = 0;
    let lastState = 'todo';

    while (elapsed < maxWait) {
      await sleep(pollInterval);
      elapsed += pollInterval;

      try {
        const resp = execSync(
          `curl -s ${ANC_URL}/api/v1/tasks/${taskId}`,
          { encoding: 'utf-8', timeout: 5_000 }
        );
        const raw = JSON.parse(resp);
        const t = raw.task || raw;
        const state = t.state;
        if (state !== lastState) {
          console.log(`    [ANC] State: ${lastState} → ${state} (${elapsed/1000}s)`);
          lastState = state;
        }

        // Helper: try both workspace paths (dispatch uses taskId-engineer)
        const getHandoff = () =>
          t.handoffSummary || readWorkspaceHandoff(dispatchIssueKey) || readWorkspaceHandoff(taskId) || '';
        const getDiff = () =>
          captureWorkspaceDiff(dispatchIssueKey) || captureWorkspaceDiff(taskId) || '';

        // Check for HANDOFF.md directly in workspace — the Stop hook may not
        // fire reliably in interactive mode, so we detect completion ourselves.
        if (state === 'running') {
          const directHandoff = readWorkspaceHandoff(dispatchIssueKey) || readWorkspaceHandoff(taskId);
          if (directHandoff) {
            output = directHandoff;
            const diff = getDiff();
            if (diff) output += `\n\n--- Git Diff ---\n${diff.slice(0, 4000)}`;
            console.log(`    [ANC] HANDOFF.md detected in workspace (${elapsed/1000}s)`);
            break;
          }
        }

        // Terminal states — capture output
        if (state === 'done' || state === 'review') {
          output = getHandoff();
          if (!output) output = `Task completed with state=${state}`;
          console.log(`    [ANC] Completed: state=${state} (${elapsed/1000}s)`);
          break;
        }

        if (state === 'failed') {
          output = getHandoff();
          if (!output) output = captureTmuxPane(tmuxSession) || '';
          if (!output) output = getDiff();
          output = `TASK_FAILED: ${output || 'no details'}`;
          console.log(`    [ANC] Failed (${elapsed/1000}s)`);
          break;
        }

        // Check for session death (agent crashed or finished without state update)
        const tmuxAlive = isTmuxAlive(tmuxSession);
        if (!tmuxAlive && state !== 'todo' && elapsed > 30_000) {
          // Only consider dead after 30s (give agent time to start)
          output = getHandoff();
          if (!output) output = getDiff();
          if (!output) output = 'Agent session ended without HANDOFF';
          console.log(`    [ANC] Tmux dead, capturing output (${elapsed/1000}s)`);
          break;
        }
        if (!tmuxAlive && elapsed <= 30_000) {
          console.log(`    [ANC] Tmux not found at ${elapsed/1000}s (may still be starting, waiting...)`);
        }
      } catch { /* continue polling */ }

      if (elapsed % 60_000 === 0) {
        console.log(`    [ANC] ... waiting ${elapsed / 1000}s (state=${lastState})`);
      }
    }

    // Timeout — capture whatever output exists
    if (!output) {
      console.log(`    [ANC] Timeout after ${maxWait/1000}s, capturing available output`);
      output = readWorkspaceHandoff(dispatchIssueKey) || readWorkspaceHandoff(taskId) || '';
      if (!output) output = captureTmuxPane(tmuxSession) || '';
      if (!output) output = captureWorkspaceDiff(dispatchIssueKey) || captureWorkspaceDiff(taskId) || '';
      output = output ? `TIMEOUT (partial output): ${output}` : 'TIMEOUT: agent did not complete within 30 minutes';
    }

    // Append git diff to output for SWE-bench ground truth comparison
    const agentDiff = captureWorkspaceDiff(dispatchIssueKey) || captureWorkspaceDiff(taskId);
    if (agentDiff && !output.includes('Git Diff')) {
      output += `\n\n--- Git Diff ---\n${agentDiff.slice(0, 4000)}`;
    }

    // Get cost
    let cost = 0, tokens = 0;
    try {
      const budgetResp = execSync(
        `curl -s ${ANC_URL}/api/v1/budget`,
        { encoding: 'utf-8', timeout: 5_000 }
      );
      const b = JSON.parse(budgetResp);
      cost = b.today_cost || 0;
      tokens = b.today_tokens || 0;
    } catch { /* ignore */ }

    return { output, interactionLog, tokens, cost };
  } catch (e: any) {
    console.error(`    [ANC Error] ${e.message}`);
    return { output: 'EXECUTION_ERROR: ' + e.message, interactionLog, tokens: 0, cost: 0 };
  }
}

// --- Memory/retro context for prompt injection ---

function loadMemoryContext(): string {
  const memDir = join(ANC_ROOT, 'personas');
  try {
    const base = readFileSync(join(memDir, 'base.md'), 'utf-8');
    return base.slice(0, 2000);
  } catch { return ''; }
}

function loadRetroContext(): string {
  // Simulated retrospectives from prior tasks in the same stream
  return `## Recent Retrospectives
- Previous task in this repo: learned that this codebase uses conventional commits and has strict CI checks. Always run tests before submitting.
- Two tasks ago: discovered that changes to parser modules require updating snapshot tests in tests/fixtures/.
- Pattern: issues in this repo often have related PRs linked in comments — check those for context before starting from scratch.`;
}

function buildConditionPrompt(task: TaskSpec, condition: AblationCondition): string {
  const baseRole = `You are a software engineer working in the ANC (Agent Native Company) system.`;

  const taskBlock = `## Task
Title: ${task.title}
Repository: ${task.repo}
Description: ${task.description}
Complexity: ${task.complexity}

Provide a complete solution: code changes, explanation, and tests. Write a HANDOFF.md summarizing your work.`;

  if (condition.name === 'vanilla_baseline') {
    return `You are a software engineer. Complete this task:\n\n${taskBlock}`;
  }

  // ANC persona components
  const ancPersona = `${baseRole}
You work autonomously in an isolated workspace. You have access to the full repository.
When done, write a HANDOFF.md with: ## Summary, ## Changes (with diffs), ## Tests, ## Verification.
Communicate clearly — your CEO reviews your HANDOFF.md to evaluate your work.`;

  const memoryBlock = condition.memory !== 'none'
    ? `\n## Accumulated Knowledge\n${loadMemoryContext()}`
    : '';

  const retroBlock = condition.memory === 'full'
    ? `\n${loadRetroContext()}`
    : '';

  const oversightBlock = condition.ceo_office
    ? `\n## CEO Office Monitoring
A CEO Office agent monitors your work. If you get stuck for >5 minutes, it will intervene.
If you encounter errors, report them clearly — don't silently fail.
If you need help, write BLOCKED.md explaining what you need.`
    : '';

  const reviewBlock = condition.review_policy === 'strict'
    ? `\n## Review Policy: STRICT
Your work WILL be reviewed by the CEO before acceptance. Be thorough. Include tests. Explain your reasoning.`
    : condition.review_policy === 'autonomous'
    ? `\n## Review Policy: AUTONOMOUS
Your work will be auto-accepted. Move fast but maintain quality. No review gate.`
    : `\n## Review Policy: NORMAL
Your work may be reviewed. Balance thoroughness with speed.`;

  return `${ancPersona}${memoryBlock}${retroBlock}${oversightBlock}${reviewBlock}\n\n${taskBlock}`;
}

// ANC API execution removed — see research/EVAL_INTEGRATION_ISSUES.md
// Will be restored when ANC fixes task state transitions for API-created tasks

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- Ablation conditions ---

export const CONDITIONS: AblationCondition[] = [
  {
    name: 'vanilla_baseline',
    memory: 'none',
    ceo_office: false,
    review_policy: 'autonomous',
  },
  {
    name: 'anc_no_memory',
    memory: 'none',
    ceo_office: true,
    review_policy: 'normal',
  },
  {
    name: 'anc_memory_no_retros',
    memory: 'flat',
    ceo_office: true,
    review_policy: 'normal',
  },
  {
    name: 'anc_full',
    memory: 'full',
    ceo_office: true,
    review_policy: 'normal',
  },
  {
    name: 'anc_no_oversight',
    memory: 'full',
    ceo_office: false,
    review_policy: 'normal',
  },
  {
    name: 'anc_strict_review',
    memory: 'full',
    ceo_office: true,
    review_policy: 'strict',
  },
  {
    name: 'anc_autonomous_review',
    memory: 'full',
    ceo_office: true,
    review_policy: 'autonomous',
  },
];

// --- CLI entry ---

if (import.meta.url === `file://${process.argv[1]}`) {
  const tasksFile = process.argv[2] || join(DATA_DIR, 'tasks.json');
  const conditionName = process.argv[3] || 'anc_full';

  if (!existsSync(tasksFile)) {
    console.error(`Tasks file not found: ${tasksFile}`);
    console.error('Usage: npx tsx simceo.ts <tasks.json> [condition_name]');
    console.error('Conditions:', CONDITIONS.map((c) => c.name).join(', '));
    process.exit(1);
  }

  const tasks: TaskSpec[] = JSON.parse(readFileSync(tasksFile, 'utf-8'));
  const condition = CONDITIONS.find((c) => c.name === conditionName);

  if (!condition) {
    console.error(`Unknown condition: ${conditionName}`);
    process.exit(1);
  }

  const outputDir = join(RESULTS_DIR, `run_${new Date().toISOString().slice(0, 10)}`);

  runExperiment(tasks, condition, outputDir).then((results) => {
    const avgSat = results.reduce((s, r) => s + r.rating.satisfaction, 0) / results.length;
    const completion = results.filter((r) => r.rating.task_completion === 1).length / results.length;
    console.log(`\n[Summary] ${condition.name}: avg satisfaction=${avgSat.toFixed(2)}, completion=${(completion * 100).toFixed(1)}%`);
  });
}
