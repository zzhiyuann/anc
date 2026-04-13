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

import { execSync, spawn } from 'child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

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

async function executeTask(
  task: TaskSpec,
  condition: AblationCondition
): Promise<TaskExecution> {
  const interactionLog: string[] = [];

  // All conditions use claude -p with varying organizational context.
  // ANC's organizational patterns are encoded as system prompt variations:
  // - vanilla_baseline: raw engineer, no organizational context
  // - anc_no_memory: ANC persona but no accumulated knowledge
  // - anc_memory_no_retros: ANC persona + memory, no retrospectives
  // - anc_full: ANC persona + memory + retrospectives
  // - anc_no_oversight: no CEO Office monitoring instructions
  // - anc_strict_review: strict review gate in persona
  // - anc_autonomous_review: autonomous, no review gate

  const prompt = buildConditionPrompt(task, condition);
  const output = claudePrint(prompt, 8192);
  return { output, interactionLog: [], tokens: 0, cost: 0 };
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
