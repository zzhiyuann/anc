/**
 * Batch spawn — start multiple agents sequentially with a delay between each.
 * Usage: anc batch ANC-1 ANC-2 ANC-3
 */

import chalk from 'chalk';
import { resolveSession } from '../runtime/resolve.js';
import { getAgent } from '../agents/registry.js';

const DELAY_MS = 5000;  // per PLAN.md: 5-second delay between spawns

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function batchCommand(issueKeys: string[], role: string): Promise<void> {
  if (issueKeys.length === 0) {
    console.log(chalk.dim('No issue keys provided'));
    return;
  }

  // Validate role before starting so we fail fast instead of per-issue
  if (!getAgent(role)) {
    console.error(chalk.red(`Unknown agent role: ${role}`));
    process.exit(1);
  }

  console.log(chalk.bold(`Batch spawning ${issueKeys.length} sessions as ${role}...\n`));

  let succeeded = 0;
  let failed = 0;

  for (let i = 0; i < issueKeys.length; i++) {
    const key = issueKeys[i];

    try {
      const result = resolveSession({ role, issueKey: key });
      if (result.action === 'blocked') {
        console.log(chalk.red(`  \u2717 ${key} — blocked: ${result.error}`));
        failed++;
      } else {
        console.log(chalk.green(`  \u2713 ${key} — ${result.action}${result.tmuxSession ? ` (${result.tmuxSession})` : ''}`));
        succeeded++;
      }
    } catch (err) {
      console.log(chalk.red(`  \u2717 ${key} — ${(err as Error).message}`));
      failed++;
    }

    // Delay between spawns (skip after last)
    if (i < issueKeys.length - 1) {
      await sleep(DELAY_MS);
    }
  }

  console.log(`\n${chalk.bold('Summary:')} ${chalk.green(`${succeeded} succeeded`)}, ${chalk.red(`${failed} failed`)}`);
}
