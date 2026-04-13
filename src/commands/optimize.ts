/**
 * CLI command: `anc optimize [--dry-run]`
 *
 * Runs one optimization cycle, outputs metrics and proposed experiment.
 */

import chalk from 'chalk';
import { runOptimizationCycle } from '../core/optimizer.js';

export function optimizeCommand(opts: { dryRun?: boolean } = {}): void {
  const result = runOptimizationCycle({ dryRun: opts.dryRun });
  const { metrics, measured, proposed, applied } = result;

  console.log(chalk.bold('\n--- System Metrics (7-day window) ---'));
  console.log(`  Tasks: ${metrics.tasks.total} total, ${metrics.tasks.done} done, ${metrics.tasks.failed} failed`);
  console.log(`  Quality: avg=${metrics.quality.avgScore.toFixed(1)}, below-60=${metrics.quality.belowThreshold}`);
  console.log(`  Cost: $${metrics.cost.totalUsd.toFixed(2)} total, $${metrics.cost.avgPerTask.toFixed(2)}/task`);
  const avgMin = (metrics.tasks.avgCompletionMs / 60_000).toFixed(1);
  console.log(`  Completion: avg ${avgMin} min`);

  if (measured) {
    console.log(chalk.bold('\n--- Experiment Result ---'));
    const icon = measured.accepted ? chalk.green('ACCEPTED') : chalk.red('REJECTED');
    console.log(`  ${measured.experimentId}: ${icon}`);
    console.log(`  Improvement: ${measured.improvement.toFixed(1)}%`);
    console.log(`  Reason: ${measured.reason}`);
  }

  if (proposed) {
    console.log(chalk.bold('\n--- Proposed Experiment ---'));
    console.log(`  ID: ${proposed.id}`);
    console.log(`  Target: ${proposed.target}`);
    console.log(`  Hypothesis: ${proposed.hypothesis}`);
    console.log(`  Metric: ${proposed.metric} (baseline: ${proposed.baselineValue.toFixed(2)})`);
    if (opts.dryRun) {
      console.log(chalk.yellow('  [DRY RUN] Experiment not applied'));
    } else if (applied) {
      console.log(chalk.green('  Experiment applied and running'));
    }
  } else if (!measured) {
    console.log(chalk.dim('\n  No experiment proposed — all metrics within acceptable ranges.'));
  }

  console.log();
}
