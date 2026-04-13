#!/usr/bin/env npx tsx
/**
 * SimCEO Validation — Human CEO Calibration
 *
 * Generates a set of 30 tasks for the real CEO (you) to rate.
 * Then compares your ratings with SimCEO's ratings on the same tasks
 * to compute correlation (Pearson ρ). If ρ > 0.6, SimCEO is validated.
 *
 * Workflow:
 * 1. `npx tsx simceo-validate.ts generate` — create 30 calibration tasks
 * 2. Run each task through ANC, collect agent outputs
 * 3. `npx tsx simceo-validate.ts rate` — SimCEO rates all outputs
 * 4. You rate the same outputs in `human_ratings.json`
 * 5. `npx tsx simceo-validate.ts compare` — compute correlation
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { rateTaskOutput, CONDITIONS } from './simceo.js';

import { fileURLToPath } from 'url';
import { dirname } from 'path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const VALIDATION_DIR = join(__dirname, '..', 'results', 'validation');

// --- Calibration tasks (hand-picked for diversity) ---

const CALIBRATION_TASKS = [
  // Low complexity
  { id: 'cal_01', title: 'Fix typo in README.md', description: 'The README has "recieve" instead of "receive" on line 42. Fix all typo instances.', complexity: 'low' as const },
  { id: 'cal_02', title: 'Add .gitignore entry for .env.local', description: 'Environment files are being committed. Add .env.local and .env.*.local to .gitignore.', complexity: 'low' as const },
  { id: 'cal_03', title: 'Update copyright year in LICENSE', description: 'License file says 2024, should be 2025.', complexity: 'low' as const },
  { id: 'cal_04', title: 'Remove unused import in utils.ts', description: 'ESLint reports unused import of `lodash` in src/utils.ts. Remove it.', complexity: 'low' as const },
  { id: 'cal_05', title: 'Add alt text to all images in docs', description: 'Accessibility audit found 3 images without alt text in docs/getting-started.md.', complexity: 'low' as const },

  // Medium complexity
  { id: 'cal_06', title: 'Add input validation to POST /tasks endpoint', description: 'The POST /api/v1/tasks endpoint accepts any body without validation. Add zod schema validation for title (required, 1-200 chars), description (optional, max 5000 chars), priority (1-5).', complexity: 'medium' as const },
  { id: 'cal_07', title: 'Implement rate limiting for API endpoints', description: 'Add rate limiting to prevent abuse. Use a sliding window counter: 100 requests per minute per IP. Return 429 with Retry-After header when exceeded.', complexity: 'medium' as const },
  { id: 'cal_08', title: 'Add unit tests for priority queue', description: 'The priority queue in src/routing/queue.ts has no tests. Write tests covering: enqueue, dequeue by priority, delay-until, retry count, max retries, stale item cleanup.', complexity: 'medium' as const },
  { id: 'cal_09', title: 'Implement graceful shutdown', description: 'When receiving SIGTERM, the server should: 1) stop accepting new connections, 2) wait for active agent sessions to reach a checkpoint, 3) persist queue state, 4) exit cleanly.', complexity: 'medium' as const },
  { id: 'cal_10', title: 'Add structured logging with pino', description: 'Replace console.log/error calls with structured logging using pino. Add request ID tracking, log levels (debug/info/warn/error), and JSON output format.', complexity: 'medium' as const },
  { id: 'cal_11', title: 'Create a health check dashboard widget', description: 'Add a health check component to the dashboard that shows: server uptime, active agents, queue depth, budget remaining, last event time. Poll /health/detailed every 30s.', complexity: 'medium' as const },
  { id: 'cal_12', title: 'Implement task search with filters', description: 'Add search to GET /tasks: text search on title/description, filter by status, agent, labels, date range. Use SQLite FTS5 for text search.', complexity: 'medium' as const },
  { id: 'cal_13', title: 'Add Discord slash commands', description: 'Implement Discord slash commands: /status (system overview), /assign <issue> <agent> (dispatch), /budget (today spend). Register commands on bot startup.', complexity: 'medium' as const },
  { id: 'cal_14', title: 'Implement agent session resume', description: 'When an agent session is interrupted (OOM, timeout), implement resume: save session state to disk, detect incomplete sessions on startup, resume with --continue flag.', complexity: 'medium' as const },
  { id: 'cal_15', title: 'Add cost attribution per task', description: 'Track API costs per task (not just per agent). When a task completes, compute total cost from all sessions that worked on it. Show in task detail API response.', complexity: 'medium' as const },

  // High complexity
  { id: 'cal_16', title: 'Implement multi-runtime adapter for Aider', description: 'Add Aider as a second runtime backend alongside Claude Code. Create an adapter that: spawns aider with --message flag, captures output, handles completion detection, maps to ANC session lifecycle. Must pass existing runtime tests.', complexity: 'high' as const },
  { id: 'cal_17', title: 'Build agent-to-agent communication protocol', description: 'Implement @-mention dispatch: when Agent A mentions @engineer in a comment, ANC should dispatch Engineer on the same task as a contributor. Handle: mention parsing, dispatch creation, shared workspace, conflict prevention.', complexity: 'high' as const },
  { id: 'cal_18', title: 'Implement knowledge graph for shared memory', description: 'Replace flat-file shared memory with a knowledge graph. Entities: concepts, decisions, patterns, people. Relationships: depends-on, supersedes, relates-to. Query API: find related knowledge given a task description. Use SQLite for storage.', complexity: 'high' as const },
  { id: 'cal_19', title: 'Add comprehensive E2E test suite', description: 'Create an end-to-end test suite that: starts ANC server, creates a task via API, verifies routing, checks agent spawn, waits for completion, verifies HANDOFF.md, checks status transitions. Must clean up after each test. Target: 10 E2E scenarios.', complexity: 'high' as const },
  { id: 'cal_20', title: 'Implement real-time process capture for dashboard', description: 'Stream agent tool calls (file edits, terminal commands, search results) to the dashboard in real-time via WebSocket. Parse Claude Code output format, extract structured events, broadcast to connected clients. Show as a live activity feed.', complexity: 'high' as const },

  // Additional medium tasks for statistical power
  { id: 'cal_21', title: 'Add pagination to all list endpoints', description: 'Implement cursor-based pagination for GET /tasks, GET /agents, GET /events. Support limit (default 50, max 200) and cursor parameters. Return next_cursor in response.', complexity: 'medium' as const },
  { id: 'cal_22', title: 'Implement webhook retry with exponential backoff', description: 'When outgoing webhooks (to Discord, Telegram) fail, retry with exponential backoff: 1s, 5s, 25s, max 3 retries. Log failures. Add circuit breaker after 5 consecutive failures.', complexity: 'medium' as const },
  { id: 'cal_23', title: 'Add OpenTelemetry tracing', description: 'Instrument the event bus and API with OpenTelemetry traces. Each task should be traceable from creation through routing, agent spawn, and completion. Export to console (development) or OTLP (production).', complexity: 'medium' as const },
  { id: 'cal_24', title: 'Create CLI command for bulk task import', description: 'Add `anc import <file.json>` that reads a JSON array of task specs and creates them all via the API. Support dry-run mode, progress bar, and error recovery (skip failed, continue).', complexity: 'medium' as const },
  { id: 'cal_25', title: 'Implement agent skill tracking', description: 'Track which types of tasks each agent has completed successfully. Store as skill tags with proficiency scores (0-1). Use skills for smarter routing: prefer agents with relevant skills.', complexity: 'medium' as const },

  // Edge cases and failure scenarios
  { id: 'cal_26', title: 'Handle concurrent task dispatch race condition', description: 'When two tasks arrive simultaneously for the same agent (maxConcurrency=1), one should queue while the other runs. Currently both may try to spawn. Add mutex/lock to resolve gate.', complexity: 'medium' as const },
  { id: 'cal_27', title: 'Fix memory injection exceeding context window', description: 'When an agent has accumulated many memories, the injected CLAUDE.md exceeds Claude context limits. Implement token-aware truncation: prioritize recent retros, high-importance memories, and task-relevant content.', complexity: 'high' as const },
  { id: 'cal_28', title: 'Add database migration system', description: 'SQLite schema changes currently require manual migration. Implement a simple migration system: numbered migration files in migrations/, auto-run on startup, track applied migrations in a meta table.', complexity: 'medium' as const },
  { id: 'cal_29', title: 'Implement task dependencies', description: 'Allow tasks to declare dependencies: task B blocks on task A. When A completes, automatically unblock B. Show dependency graph in dashboard. Handle circular dependency detection.', complexity: 'high' as const },
  { id: 'cal_30', title: 'Add support for task templates', description: 'Allow creating reusable task templates (e.g., "Deploy to staging", "Security audit") with pre-filled title, description, labels, agent, and review policy. CRUD API + dashboard UI.', complexity: 'medium' as const },
];

// --- Commands ---

function generate() {
  mkdirSync(VALIDATION_DIR, { recursive: true });

  const tasks = CALIBRATION_TASKS.map((t) => ({
    ...t,
    repo: 'anc',
    expected_labels: [],
    source: 'custom' as const,
  }));

  writeFileSync(
    join(VALIDATION_DIR, 'calibration_tasks.json'),
    JSON.stringify(tasks, null, 2)
  );

  // Create empty human ratings template
  const template = tasks.map((t) => ({
    task_id: t.id,
    title: t.title,
    complexity: t.complexity,
    satisfaction: null, // YOU fill this in (1-5)
    task_completion: null, // 0 or 1
    code_quality: null, // 1-5
    notes: '',
  }));

  writeFileSync(
    join(VALIDATION_DIR, 'human_ratings.json'),
    JSON.stringify(template, null, 2)
  );

  console.log(`Generated ${tasks.length} calibration tasks`);
  console.log(`  Tasks: ${VALIDATION_DIR}/calibration_tasks.json`);
  console.log(`  Human ratings template: ${VALIDATION_DIR}/human_ratings.json`);
  console.log(`\nNext steps:`);
  console.log(`  1. Run tasks through ANC and collect outputs`);
  console.log(`  2. Run: npx tsx simceo-validate.ts rate`);
  console.log(`  3. Fill in human_ratings.json with your ratings`);
  console.log(`  4. Run: npx tsx simceo-validate.ts compare`);
}

function rate() {
  const tasksFile = join(VALIDATION_DIR, 'calibration_tasks.json');
  if (!existsSync(tasksFile)) {
    console.error('Run `generate` first');
    process.exit(1);
  }

  const tasks = JSON.parse(readFileSync(tasksFile, 'utf-8'));
  const condition = CONDITIONS.find((c) => c.name === 'anc_full')!;
  const simceoRatings = [];

  console.log('SimCEO rating calibration tasks...\n');

  for (const task of tasks) {
    // For validation, we use the task description as "output" since we can't
    // run real ANC tasks in calibration mode. In real experiments, this would
    // be the actual agent output.
    const mockOutput = `[Calibration mode] Task: ${task.title}\nDescription: ${task.description}\nComplexity: ${task.complexity}`;

    const rating = rateTaskOutput(task, mockOutput, condition, []);
    simceoRatings.push(rating);
    console.log(`  ${task.id}: satisfaction=${rating.satisfaction}`);
  }

  writeFileSync(
    join(VALIDATION_DIR, 'simceo_ratings.json'),
    JSON.stringify(simceoRatings, null, 2)
  );

  console.log(`\nSimCEO ratings saved. Now fill in human_ratings.json and run 'compare'.`);
}

function compare() {
  const humanFile = join(VALIDATION_DIR, 'human_ratings.json');
  const simceoFile = join(VALIDATION_DIR, 'simceo_ratings.json');

  if (!existsSync(humanFile) || !existsSync(simceoFile)) {
    console.error('Need both human_ratings.json and simceo_ratings.json');
    process.exit(1);
  }

  const humanRatings = JSON.parse(readFileSync(humanFile, 'utf-8'));
  const simceoRatings = JSON.parse(readFileSync(simceoFile, 'utf-8'));

  // Match by task_id
  const pairs: { human: number; simceo: number; task_id: string }[] = [];

  for (const human of humanRatings) {
    if (human.satisfaction === null) continue; // skip unrated
    const simceo = simceoRatings.find((s: any) => s.task_id === human.task_id);
    if (!simceo) continue;

    pairs.push({
      task_id: human.task_id,
      human: human.satisfaction,
      simceo: simceo.satisfaction,
    });
  }

  if (pairs.length < 10) {
    console.error(`Only ${pairs.length} paired ratings. Need at least 10.`);
    process.exit(1);
  }

  // Pearson correlation
  const humanScores = pairs.map((p) => p.human);
  const simceoScores = pairs.map((p) => p.simceo);
  const rho = pearsonCorrelation(humanScores, simceoScores);

  // MAE
  const mae = pairs.reduce((s, p) => s + Math.abs(p.human - p.simceo), 0) / pairs.length;

  // Report
  console.log(`\n========================================`);
  console.log(`  SimCEO Validation Report`);
  console.log(`========================================\n`);
  console.log(`  Paired ratings: ${pairs.length}`);
  console.log(`  Pearson ρ: ${rho.toFixed(3)}`);
  console.log(`  MAE: ${mae.toFixed(2)}`);
  console.log(`  Human mean: ${mean(humanScores).toFixed(2)}±${std(humanScores).toFixed(2)}`);
  console.log(`  SimCEO mean: ${mean(simceoScores).toFixed(2)}±${std(simceoScores).toFixed(2)}`);
  console.log();

  if (rho >= 0.7) {
    console.log(`  ✓ STRONG correlation — SimCEO is well-calibrated`);
  } else if (rho >= 0.5) {
    console.log(`  ~ MODERATE correlation — SimCEO is usable but needs calibration`);
  } else {
    console.log(`  ✗ WEAK correlation — SimCEO needs significant improvement`);
  }

  // Save detailed comparison
  const report = { n: pairs.length, rho, mae, pairs };
  writeFileSync(join(VALIDATION_DIR, 'validation_report.json'), JSON.stringify(report, null, 2));
}

// --- Stat helpers ---

function mean(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function std(arr: number[]): number {
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, x) => s + (x - m) ** 2, 0) / (arr.length - 1));
}

function pearsonCorrelation(x: number[], y: number[]): number {
  const n = x.length;
  const mx = mean(x);
  const my = mean(y);
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx;
    const dy = y[i] - my;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }
  const denom = Math.sqrt(dx2 * dy2);
  return denom === 0 ? 0 : num / denom;
}

// --- CLI ---

const command = process.argv[2];

switch (command) {
  case 'generate':
    generate();
    break;
  case 'rate':
    rate();
    break;
  case 'compare':
    compare();
    break;
  default:
    console.log('Usage: npx tsx simceo-validate.ts <generate|rate|compare>');
    console.log();
    console.log('  generate  — Create 30 calibration tasks + human rating template');
    console.log('  rate      — Run SimCEO on all calibration tasks');
    console.log('  compare   — Compare human vs SimCEO ratings (Pearson ρ)');
}
