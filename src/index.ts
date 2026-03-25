#!/usr/bin/env node
/**
 * ANC CLI — Agent Native Company
 */

import { Command } from 'commander';
import chalk from 'chalk';

const program = new Command();

program
  .name('anc')
  .description('ANC — Agent Native Company. Linear-native agent orchestration.')
  .version('0.1.0');

// --- Serve ---
program
  .command('serve')
  .description('Start the webhook gateway + event handlers')
  .option('-p, --port <port>', 'Listen port', '3849')
  .action(async (opts) => {
    const { startGateway } = await import('./gateway.js');
    const { registerIssueHandlers } = await import('./hooks/on-issue.js');
    const { registerCommentHandlers } = await import('./hooks/on-comment.js');
    const { registerSessionHandlers } = await import('./hooks/on-session.js');
    const { registerCompletionHandlers } = await import('./hooks/on-complete.js');
    const { registerDiscordHandlers } = await import('./hooks/on-discord.js');
    const { startDiscordBot } = await import('./channels/discord.js');
    const { bus } = await import('./bus.js');
    const { checkAllHealth } = await import('./runtime/health.js');
    const { cleanup } = await import('./routing/queue.js');

    // Register all event handlers
    registerIssueHandlers();
    registerCommentHandlers();
    registerSessionHandlers();
    registerCompletionHandlers();
    registerDiscordHandlers();

    // Start Discord bot
    await startDiscordBot();

    // Start gateway
    startGateway(Number(opts.port));

    // Periodic tick (30s) — health checks + completion detection + queue cleanup
    setInterval(async () => {
      checkAllHealth();
      cleanup();
      await bus.emit('system:tick', { timestamp: Date.now() });
    }, 30_000);

    console.log(chalk.bold('Event handlers registered. System ready.'));
  });

// --- Agent commands ---
const agent = program.command('agent').description('Manage agents');

agent
  .command('list')
  .description('Show agent roster and status')
  .action(async () => {
    const { getRegisteredAgents } = await import('./agents/registry.js');
    const { getHealthStatus } = await import('./runtime/health.js');
    const agents = getRegisteredAgents();
    for (const a of agents) {
      const health = getHealthStatus(a.role);
      const status = health.active
        ? chalk.green(`active on ${health.issueKey} (${health.uptime}s)`)
        : chalk.dim('idle');
      console.log(`  ${chalk.bold(a.name)} (${a.role}): ${status}`);
    }
  });

agent
  .command('start <role> [issue-key]')
  .description('Start an agent on an issue')
  .option('--prompt <prompt>', 'Custom prompt')
  .action(async (role: string, issueKey?: string, opts?: { prompt?: string }) => {
    const { spawnAgent } = await import('./runtime/runner.js');
    const key = issueKey ?? 'adhoc';
    const result = spawnAgent({ role, issueKey: key, prompt: opts?.prompt });
    if (result.success) {
      console.log(chalk.green(`Started ${role} on ${key} (tmux: ${result.tmuxSession})`));
    } else {
      console.error(chalk.red(`Failed: ${result.error}`));
    }
  });

agent
  .command('stop <role>')
  .description('Stop an agent')
  .action(async (role: string) => {
    const { getActiveSession } = await import('./runtime/health.js');
    const { killAgent } = await import('./runtime/runner.js');
    const session = getActiveSession(role);
    if (!session) {
      console.log(chalk.dim(`${role} is not running`));
      return;
    }
    killAgent(session.tmuxSession);
    console.log(chalk.yellow(`Stopped ${role}`));
  });

agent
  .command('jump <role>')
  .description('Attach to an agent tmux session')
  .action(async (role: string) => {
    const { getActiveSession } = await import('./runtime/health.js');
    const { execSync } = await import('child_process');
    const session = getActiveSession(role);
    if (!session) {
      console.log(chalk.dim(`${role} is not running`));
      return;
    }
    // Open in terminal
    try {
      execSync(`open -a Ghostty tmux attach-session -t "${session.tmuxSession}"`, { stdio: 'inherit' });
    } catch {
      console.log(`Run: tmux attach-session -t "${session.tmuxSession}"`);
    }
  });

// --- Status ---
program
  .command('status')
  .description('Show system status')
  .action(async () => {
    const { getRegisteredAgents } = await import('./agents/registry.js');
    const { getHealthStatus } = await import('./runtime/health.js');
    const { getQueue } = await import('./routing/queue.js');

    console.log(chalk.bold('\nANC Status\n'));

    const agents = getRegisteredAgents();
    console.log(chalk.bold('Agents:'));
    for (const a of agents) {
      const h = getHealthStatus(a.role);
      const s = h.active ? chalk.green(`${h.issueKey} (${h.uptime}s)`) : chalk.dim('idle');
      console.log(`  ${a.role}: ${s}`);
    }

    const queued = getQueue('queued');
    if (queued.length > 0) {
      console.log(chalk.bold(`\nQueue (${queued.length}):`));
      for (const q of queued) {
        console.log(`  ${q.issueKey} → ${q.agentRole} (P${q.priority})`);
      }
    }
  });

program.parseAsync(process.argv).catch(err => {
  console.error(chalk.red(err.message));
  process.exit(1);
});
