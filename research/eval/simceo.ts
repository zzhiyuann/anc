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
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// --- Types ---

interface TaskSpec {
  id: string;
  title: string;
  description: string;
  repo: string;
  expected_labels: string[];
  complexity: 'low' | 'medium' | 'high';
  source: 'github' | 'swebench' | 'custom';
  ground_truth?: string; // path to known-good solution or test
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
  const prompt = `${SIMCEO_SYSTEM_PROMPT}

You are evaluating an agent's work under these conditions:
- Memory: ${condition.memory}
- CEO Office oversight: ${condition.ceo_office ? 'active' : 'disabled'}
- Review policy: ${condition.review_policy}

Task: ${task.title}
Description: ${task.description}
Complexity: ${task.complexity}

Agent output:
${agentOutput.slice(0, 8000)}

Interaction log (CEO-agent exchanges):
${interactionLog.join('\n').slice(0, 4000)}

Rate this output. Respond with ONLY valid JSON:
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
  ancServerProcess = spawn('npx', ['tsx', 'src/index.ts', 'serve', '--port', String(ANC_PORT)], {
    cwd: ANC_ROOT,
    env: { ...process.env, ANC_BUDGET_DISABLED: 'true' },
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

  if (condition.name === 'vanilla_baseline') {
    // Vanilla: just run claude -p on the task directly, no ANC
    const output = claudePrint(
      `You are a software engineer. Complete this task:\n\nTitle: ${task.title}\nDescription: ${task.description}\n\nProvide the solution (code changes, explanation, and any tests). Write a HANDOFF.md summarizing your work.`,
      8192
    );
    return { output, interactionLog: [], tokens: 0, cost: 0 };
  }

  // ANC-managed execution via ANC server API
  // Auto-starts ANC server if not running.
  // Flow: create task → auto-dispatch → agent works in tmux → poll for completion → capture output
  try {
    ensureAncServer();

    // Append autonomy instruction so agent doesn't ask for confirmation
    const evalDescription = [
      task.description,
      '',
      '---',
      'IMPORTANT: You are running in autonomous evaluation mode.',
      '- Do NOT ask for confirmation or permission — proceed with the best approach.',
      '- Implement the solution completely, including tests if applicable.',
      '- When done, write HANDOFF.md with ## Summary and ## Verification sections.',
      '- Do NOT wait for human input. Just do the work and write HANDOFF.md.',
    ].join('\n');

    const createBody = JSON.stringify({
      title: task.title,
      description: evalDescription,
      priority: task.complexity === 'high' ? 1 : task.complexity === 'medium' ? 2 : 3,
    });

    const createResp = execSync(
      `curl -s -X POST ${ANC_URL}/api/v1/tasks -H 'Content-Type: application/json' -d '${createBody.replace(/'/g, "'\\''")}'`,
      { encoding: 'utf-8', timeout: 10_000 }
    );
    const created = JSON.parse(createResp);
    const taskId = created.task?.id || created.id;
    const tmuxSession = created.tmuxSession || `anc-engineer-${taskId}`;
    console.log(`    [ANC] Created task ${taskId}, tmux=${tmuxSession}`);

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

        // Terminal states — capture output
        if (state === 'done' || state === 'review') {
          output = t.handoffSummary || '';
          if (!output) output = readWorkspaceHandoff(taskId) || '';
          if (!output) output = `Task completed with state=${state}`;
          console.log(`    [ANC] Completed: state=${state} (${elapsed/1000}s)`);
          break;
        }

        if (state === 'failed') {
          output = t.handoffSummary || '';
          if (!output) output = readWorkspaceHandoff(taskId) || '';
          if (!output) output = captureTmuxPane(tmuxSession) || '';
          if (!output) output = captureWorkspaceDiff(taskId) || '';
          output = `TASK_FAILED: ${output || 'no details'}`;
          console.log(`    [ANC] Failed (${elapsed/1000}s)`);
          break;
        }

        // Check for session death (agent crashed or finished without state update)
        // Use direct tmux check as ground truth — API's alive field can be stale
        // after server restarts.
        const tmuxAlive = isTmuxAlive(tmuxSession);
        if (!tmuxAlive && state !== 'todo') {
          // Tmux is dead but state didn't transition — capture output
          output = t.handoffSummary || '';
          if (!output) output = readWorkspaceHandoff(taskId) || '';
          if (!output) output = captureWorkspaceDiff(taskId) || '';
          if (!output) output = 'Agent session ended without HANDOFF';
          console.log(`    [ANC] Tmux dead, capturing output (${elapsed/1000}s)`);
          break;
        }
      } catch { /* continue polling */ }

      if (elapsed % 60_000 === 0) {
        console.log(`    [ANC] ... waiting ${elapsed / 1000}s (state=${lastState})`);
      }
    }

    // Timeout — capture whatever output exists
    if (!output) {
      console.log(`    [ANC] Timeout after ${maxWait/1000}s, capturing available output`);
      output = readWorkspaceHandoff(taskId) || '';
      if (!output) output = captureTmuxPane(tmuxSession) || '';
      if (!output) output = captureWorkspaceDiff(taskId) || '';
      output = output ? `TIMEOUT (partial output): ${output}` : 'TIMEOUT: agent did not complete within 30 minutes';
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
