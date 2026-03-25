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
    const { registerTickHandlers } = await import('./hooks/on-tick.js');
    const { registerDutyHandlers } = await import('./hooks/on-duties.js');
    const { startDiscordBot } = await import('./channels/discord.js');
    const { bus } = await import('./bus.js');
    const { cleanup } = await import('./routing/queue.js');
    const { recoverSessionsFromTmux } = await import('./runtime/runner.js');

    // Register all event handlers
    registerIssueHandlers();
    registerCommentHandlers();
    registerSessionHandlers();
    registerCompletionHandlers();
    registerDiscordHandlers();
    registerTickHandlers();
    registerDutyHandlers();

    // Recover sessions from existing tmux (after restart)
    const recovered = recoverSessionsFromTmux();
    if (recovered > 0) {
      console.log(chalk.yellow(`Recovered ${recovered} sessions from existing tmux`));
    }

    // Start Discord bot
    await startDiscordBot();

    // Start gateway
    startGateway(Number(opts.port));

    // Periodic tick (30s) — drives completion detection + scheduler + queue cleanup
    setInterval(async () => {
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
      console.log(`  ${chalk.bold(a.name)} (${a.role}) — ${health.activeSessions}/${health.maxConcurrency} active, ${health.suspendedSessions} suspended`);
      for (const s of health.sessions) {
        const icon = s.state === 'active' ? chalk.green('●') : s.state === 'idle' ? chalk.blue('○') : chalk.yellow('◐');
        const uptime = s.uptime ? ` (${s.uptime}s)` : '';
        console.log(`    ${icon} ${s.issueKey} [${s.state}]${uptime}`);
      }
    }
  });

agent
  .command('start <role> [issue-key]')
  .description('Start an agent on an issue')
  .option('--prompt <prompt>', 'Custom prompt')
  .action(async (role: string, issueKey?: string, opts?: { prompt?: string }) => {
    const { resolveSession } = await import('./runtime/runner.js');
    const key = issueKey ?? 'adhoc';
    const result = resolveSession({ role, issueKey: key, prompt: opts?.prompt });
    console.log(chalk.green(`${role} on ${key}: ${result.action}${result.tmuxSession ? ` (${result.tmuxSession})` : ''}`));
  });

agent
  .command('stop <role>')
  .description('Stop an agent')
  .action(async (role: string) => {
    const { getActiveSessions } = await import('./runtime/health.js');
    const { killAgent } = await import('./runtime/runner.js');
    const active = getActiveSessions(role);
    if (active.length === 0) {
      console.log(chalk.dim(`${role} has no active sessions`));
      return;
    }
    for (const s of active) {
      killAgent(s.tmuxSession);
      console.log(chalk.yellow(`Stopped ${role}/${s.issueKey}`));
    }
  });

agent
  .command('suspend <issue-key>')
  .description('Suspend an active session (preserves workspace + checkpoint)')
  .action(async (issueKey: string) => {
    const { suspendSession } = await import('./runtime/runner.js');
    const ok = suspendSession(issueKey);
    if (ok) console.log(chalk.yellow(`Suspended ${issueKey}`));
    else console.log(chalk.dim(`${issueKey} is not active`));
  });

agent
  .command('resume <issue-key>')
  .description('Resume a suspended session')
  .option('--prompt <prompt>', 'Additional context for the agent')
  .action(async (issueKey: string, opts?: { prompt?: string }) => {
    const { resolveSession: resolve } = await import('./runtime/runner.js');
    const { getSessionForIssue } = await import('./runtime/health.js');
    const session = getSessionForIssue(issueKey);
    if (!session) { console.log(chalk.dim(`${issueKey} not tracked`)); return; }
    const result = resolve({ role: session.role, issueKey, prompt: opts?.prompt });
    console.log(chalk.green(`${issueKey}: ${result.action}`));
  });

agent
  .command('jump <role>')
  .description('Attach to an agent tmux session')
  .action(async (role: string) => {
    const { getActiveSessions } = await import('./runtime/health.js');
    const active = getActiveSessions(role);
    if (active.length === 0) {
      console.log(chalk.dim(`${role} has no active sessions`));
      return;
    }
    // Show all active sessions — user picks which to jump to
    if (active.length === 1) {
      console.log(`Run: tmux attach-session -t "${active[0].tmuxSession}"`);
    } else {
      console.log(`${role} has ${active.length} active sessions:`);
      for (const s of active) {
        console.log(`  tmux attach-session -t "${s.tmuxSession}"  # ${s.issueKey}`);
      }
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
      console.log(`  ${a.role}: ${h.activeSessions}/${h.maxConcurrency} active, ${h.idleSessions} idle, ${h.suspendedSessions} suspended`);
      for (const s of h.sessions) {
        const icon = s.state === 'active' ? '●' : '◐';
        console.log(`    ${icon} ${s.issueKey} [${s.state}]${s.uptime ? ` ${s.uptime}s` : ''}`);
      }
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
