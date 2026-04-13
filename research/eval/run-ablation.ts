#!/usr/bin/env npx tsx
/**
 * Ablation Study Runner
 *
 * Orchestrates the full ablation experiment across all conditions.
 * Runs each condition sequentially (to avoid interference), collects
 * SimCEO ratings, and produces analysis-ready output.
 *
 * Usage:
 *   npx tsx run-ablation.ts                     # Run all conditions
 *   npx tsx run-ablation.ts --condition anc_full # Run single condition
 *   npx tsx run-ablation.ts --analyze            # Analyze existing results
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { join } from 'path';
import { CONDITIONS, runExperiment } from './simceo.js';

import { fileURLToPath } from 'url';
import { dirname } from 'path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DATA_DIR = join(__dirname, '..', 'data');
const RESULTS_DIR = join(__dirname, '..', 'results');

interface AggregateStats {
  condition: string;
  n_tasks: number;
  avg_satisfaction: number;
  std_satisfaction: number;
  completion_rate: number;
  avg_code_quality: number;
  avg_communication: number;
  avg_autonomy: number;
  avg_interventions: number;
  recovery_rate: number;
  avg_duration_s: number;
  avg_cost_usd: number;
}

// --- Statistics helpers ---

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function std(arr: number[]): number {
  if (arr.length <= 1) return 0;
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, x) => s + (x - m) ** 2, 0) / (arr.length - 1));
}

function ci95(arr: number[]): [number, number] {
  const m = mean(arr);
  const se = std(arr) / Math.sqrt(arr.length);
  return [m - 1.96 * se, m + 1.96 * se];
}

// --- Analysis ---

function analyzeResults(runDir: string): AggregateStats[] {
  const stats: AggregateStats[] = [];

  for (const condition of CONDITIONS) {
    const resultFile = join(runDir, `_results_${condition.name}.json`);
    if (!existsSync(resultFile)) {
      console.log(`  Skipping ${condition.name} (no results)`);
      continue;
    }

    const results = JSON.parse(readFileSync(resultFile, 'utf-8'));

    const satisfactions = results.map((r: any) => r.rating.satisfaction);
    const completions = results.map((r: any) => r.rating.task_completion);
    const codeQuality = results.map((r: any) => r.rating.code_quality);
    const communication = results.map((r: any) => r.rating.communication_quality);
    const autonomy = results.map((r: any) => r.rating.autonomy_score);
    const interventions = results.map((r: any) => r.rating.ceo_interventions);
    const recoveries = results.map((r: any) => r.rating.recovery_needed ? 1 : 0);
    const durations = results.map((r: any) => r.duration_ms / 1000);
    const costs = results.map((r: any) => r.cost_usd);

    const [satLo, satHi] = ci95(satisfactions);

    stats.push({
      condition: condition.name,
      n_tasks: results.length,
      avg_satisfaction: mean(satisfactions),
      std_satisfaction: std(satisfactions),
      completion_rate: mean(completions),
      avg_code_quality: mean(codeQuality),
      avg_communication: mean(communication),
      avg_autonomy: mean(autonomy),
      avg_interventions: mean(interventions),
      recovery_rate: mean(recoveries),
      avg_duration_s: mean(durations),
      avg_cost_usd: mean(costs),
    });

    console.log(`  ${condition.name}: satisfaction=${mean(satisfactions).toFixed(2)}±${std(satisfactions).toFixed(2)} [${satLo.toFixed(2)}, ${satHi.toFixed(2)}], completion=${(mean(completions) * 100).toFixed(1)}%`);
  }

  return stats;
}

function generateMarkdownReport(stats: AggregateStats[], outputPath: string) {
  let md = `# Ablation Study Results\n\n`;
  md += `Generated: ${new Date().toISOString()}\n\n`;

  // Main comparison table
  md += `## Overall Comparison\n\n`;
  md += `| Condition | N | Satisfaction | Completion | Code Quality | Autonomy | CEO Interventions |\n`;
  md += `|-----------|---|-------------|------------|-------------|---------|------------------|\n`;

  for (const s of stats) {
    md += `| ${s.condition} | ${s.n_tasks} | ${s.avg_satisfaction.toFixed(2)}±${s.std_satisfaction.toFixed(2)} | ${(s.completion_rate * 100).toFixed(1)}% | ${s.avg_code_quality.toFixed(2)} | ${s.avg_autonomy.toFixed(2)} | ${s.avg_interventions.toFixed(1)} |\n`;
  }

  // Design-specific comparisons
  md += `\n## Design Pattern Analysis\n\n`;

  // Memory ablation
  md += `### Design 1: Memory + Retrospectives\n\n`;
  const memNone = stats.find((s) => s.condition === 'anc_no_memory');
  const memFlat = stats.find((s) => s.condition === 'anc_memory_no_retros');
  const memFull = stats.find((s) => s.condition === 'anc_full');

  if (memNone && memFlat && memFull) {
    md += `| | No Memory | Memory Only | Memory + Retros |\n`;
    md += `|---|---|---|---|\n`;
    md += `| Satisfaction | ${memNone.avg_satisfaction.toFixed(2)} | ${memFlat.avg_satisfaction.toFixed(2)} | ${memFull.avg_satisfaction.toFixed(2)} |\n`;
    md += `| Completion | ${(memNone.completion_rate * 100).toFixed(1)}% | ${(memFlat.completion_rate * 100).toFixed(1)}% | ${(memFull.completion_rate * 100).toFixed(1)}% |\n`;
    md += `| Δ vs baseline | — | ${(memFlat.avg_satisfaction - memNone.avg_satisfaction).toFixed(2)} | ${(memFull.avg_satisfaction - memNone.avg_satisfaction).toFixed(2)} |\n`;
  }

  // CEO Office ablation
  md += `\n### Design 2: Meta-Agent Oversight (CEO Office)\n\n`;
  const noOversight = stats.find((s) => s.condition === 'anc_no_oversight');

  if (noOversight && memFull) {
    md += `| | No CEO Office | With CEO Office |\n`;
    md += `|---|---|---|\n`;
    md += `| Satisfaction | ${noOversight.avg_satisfaction.toFixed(2)} | ${memFull.avg_satisfaction.toFixed(2)} |\n`;
    md += `| Recovery Rate | ${(noOversight.recovery_rate * 100).toFixed(1)}% | ${(memFull.recovery_rate * 100).toFixed(1)}% |\n`;
    md += `| CEO Interventions | ${noOversight.avg_interventions.toFixed(1)} | ${memFull.avg_interventions.toFixed(1)} |\n`;
    md += `| Δ satisfaction | — | ${(memFull.avg_satisfaction - noOversight.avg_satisfaction).toFixed(2)} |\n`;
  }

  // Review policy ablation
  md += `\n### Design 3: Configurable Delegation (Review Policy)\n\n`;
  const strict = stats.find((s) => s.condition === 'anc_strict_review');
  const autonomous = stats.find((s) => s.condition === 'anc_autonomous_review');

  if (strict && memFull && autonomous) {
    md += `| | Strict | Normal | Autonomous |\n`;
    md += `|---|---|---|---|\n`;
    md += `| Satisfaction | ${strict.avg_satisfaction.toFixed(2)} | ${memFull.avg_satisfaction.toFixed(2)} | ${autonomous.avg_satisfaction.toFixed(2)} |\n`;
    md += `| Autonomy Score | ${strict.avg_autonomy.toFixed(2)} | ${memFull.avg_autonomy.toFixed(2)} | ${autonomous.avg_autonomy.toFixed(2)} |\n`;
    md += `| CEO Interventions | ${strict.avg_interventions.toFixed(1)} | ${memFull.avg_interventions.toFixed(1)} | ${autonomous.avg_interventions.toFixed(1)} |\n`;
    md += `| Duration (s) | ${strict.avg_duration_s.toFixed(0)} | ${memFull.avg_duration_s.toFixed(0)} | ${autonomous.avg_duration_s.toFixed(0)} |\n`;
  }

  writeFileSync(outputPath, md);
  console.log(`\nReport saved: ${outputPath}`);
}

// --- Main ---

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--analyze')) {
    // Find latest run directory
    const runs = readdirSync(RESULTS_DIR)
      .filter((d) => d.startsWith('run_'))
      .sort()
      .reverse();

    if (runs.length === 0) {
      console.error('No results found. Run experiments first.');
      process.exit(1);
    }

    const runDir = join(RESULTS_DIR, runs[0]);
    console.log(`Analyzing ${runDir}...\n`);

    const stats = analyzeResults(runDir);
    generateMarkdownReport(stats, join(runDir, 'report.md'));
    writeFileSync(join(runDir, 'stats.json'), JSON.stringify(stats, null, 2));
    return;
  }

  // Load tasks
  const tasksFile = join(DATA_DIR, 'github', 'tasks.json');
  if (!existsSync(tasksFile)) {
    console.error(`Tasks file not found: ${tasksFile}`);
    console.error('Run github-streams.ts first to generate tasks.');
    process.exit(1);
  }

  const allTasks = JSON.parse(readFileSync(tasksFile, 'utf-8'));

  // Filter conditions
  const conditionFilter = args.find((a) => a.startsWith('--condition='))?.split('=')[1];
  const conditions = conditionFilter
    ? CONDITIONS.filter((c) => c.name === conditionFilter)
    : CONDITIONS;

  if (conditions.length === 0) {
    console.error(`Unknown condition: ${conditionFilter}`);
    process.exit(1);
  }

  // Select task subset for experiments
  // For longitudinal memory evaluation, use sequential tasks from the same stream
  const taskSubset = allTasks.slice(0, 20); // Start with 20 tasks per condition

  const runId = `run_${new Date().toISOString().slice(0, 19).replace(/[:-]/g, '')}`;
  const runDir = join(RESULTS_DIR, runId);
  mkdirSync(runDir, { recursive: true });

  console.log(`\n========================================`);
  console.log(`  ANC Ablation Study`);
  console.log(`  Run ID: ${runId}`);
  console.log(`  Tasks: ${taskSubset.length}`);
  console.log(`  Conditions: ${conditions.map((c) => c.name).join(', ')}`);
  console.log(`========================================\n`);

  // Save experiment config
  writeFileSync(
    join(runDir, 'config.json'),
    JSON.stringify({ runId, tasks: taskSubset.length, conditions: conditions.map((c) => c.name) }, null, 2)
  );

  // Run each condition sequentially
  for (const condition of conditions) {
    await runExperiment(taskSubset, condition, runDir);
  }

  // Analyze
  console.log(`\n\n========================================`);
  console.log(`  Analysis`);
  console.log(`========================================\n`);

  const stats = analyzeResults(runDir);
  generateMarkdownReport(stats, join(runDir, 'report.md'));
  writeFileSync(join(runDir, 'stats.json'), JSON.stringify(stats, null, 2));
}

main().catch(console.error);
