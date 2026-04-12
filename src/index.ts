#!/usr/bin/env node
/**
 * ANC CLI — Agent Native Company
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';
import { Command } from 'commander';
import chalk from 'chalk';

// Load .env from project root (no dotenv dependency needed — Node 20.12+)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envFile = join(__dirname, '..', '.env');
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

const program = new Command();

program
  .name('anc')
  .description('ANC — Agent Native Company. Linear-native agent orchestration.')
  .version('0.1.0');

// --- Setup ---
program
  .command('setup')
  .description('Initialize ANC — create directories, validate credentials')
  .action(async () => {
    const { setupCommand } = await import('./commands/setup.js');
    await setupCommand();
  });

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
    const { registerLifecycleHandlers } = await import('./hooks/on-lifecycle.js');
    const { registerBridgeHandlers } = await import('./hooks/on-bridge.js');
    const { startDiscordBot, stopDiscordBot } = await import('./channels/discord.js');
    const { bus } = await import('./bus.js');
    const { attachEventLogger } = await import('./core/events.js');
    attachEventLogger(bus as unknown as { on: (ev: string, l: (d: unknown) => void) => unknown });
    const { cleanup } = await import('./routing/queue.js');
    const { recoverSessionsFromTmux } = await import('./runtime/runner.js');
    const { createLogger } = await import('./core/logger.js');
    const log = createLogger('system');

    // Register all event handlers
    registerIssueHandlers();
    registerCommentHandlers();
    registerSessionHandlers();
    registerCompletionHandlers();
    registerDiscordHandlers();
    registerBridgeHandlers();
    registerTickHandlers();
    registerDutyHandlers();
    registerLifecycleHandlers();

    // Recover sessions from existing tmux (after restart)
    const recovered = recoverSessionsFromTmux();
    if (recovered > 0) {
      log.info(`Recovered ${recovered} sessions from existing tmux`);
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

    // Event logging to DB
    const { logEvent, closeDb, backupDb } = await import('./core/db.js');
    bus.on('agent:spawned', ({ role, issueKey }) => logEvent('spawned', role, issueKey));
    bus.on('agent:completed', ({ role, issueKey }) => logEvent('completed', role, issueKey));
    bus.on('agent:failed', ({ role, issueKey, error }) => logEvent('failed', role, issueKey, error));
    bus.on('agent:idle', ({ role, issueKey }) => logEvent('idle', role, issueKey));
    bus.on('agent:suspended', ({ role, issueKey, reason }) => logEvent('suspended', role, issueKey, reason));
    bus.on('agent:resumed', ({ role, issueKey }) => logEvent('resumed', role, issueKey));

    // Periodic DB backup (every 30 min)
    setInterval(() => backupDb(), 30 * 60_000);

    // Graceful shutdown
    const shutdown = (signal: string) => {
      log.info(`[${signal}] Shutting down...`);
      try { stopDiscordBot(); } catch { /**/ }
      closeDb();
      process.exit(0);
    };
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));

    // Global error handlers — log and continue (don't crash the server)
    process.on('uncaughtException', (err) => {
      log.error(`Uncaught exception: ${err.message}\n${err.stack ?? ''}`);
    });
    process.on('unhandledRejection', (reason) => {
      const msg = reason instanceof Error ? reason.message : String(reason);
      log.error(`Unhandled rejection: ${msg}`);
    });

    log.info('Event handlers registered. System ready.');
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
    const { resolveSession } = await import('./runtime/resolve.js');
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
    const { resolveSession: resolve } = await import('./runtime/resolve.js');
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

// --- Agent SDK commands (run inside agent tmux sessions) ---
program
  .command('comment [issue-key]')
  .description('Post a comment as the current agent')
  .argument('<message>', 'Comment body')
  .action(async (issueKey: string | undefined, message: string) => {
    // commander parses: anc comment ANC-66 "msg" → issueKey=ANC-66, message="msg"
    //                   anc comment "msg"        → issueKey="msg", message=undefined
    if (!message) { message = issueKey!; issueKey = undefined; }
    const { commentCommand } = await import('./commands/sdk.js');
    await commentCommand(issueKey, message);
  });

program
  .command('read-issue [issue-key]')
  .description('Read issue details, comments, and sub-issues')
  .action(async (issueKey?: string) => {
    const { readIssueCommand } = await import('./commands/sdk.js');
    await readIssueCommand(issueKey);
  });

program
  .command('create-sub [parent-key]')
  .description('Create a sub-issue under the current or specified issue')
  .argument('<title>', 'Sub-issue title')
  .argument('[description]', 'Sub-issue description', '')
  .action(async (parentKey: string | undefined, title: string, description: string) => {
    if (!description && !title) { title = parentKey!; parentKey = undefined; }
    const { createSubCommand } = await import('./commands/sdk.js');
    await createSubCommand(parentKey, title, description);
  });

program
  .command('search <term>')
  .description('Search Linear issues')
  .action(async (term: string) => {
    const { searchCommand } = await import('./commands/sdk.js');
    await searchCommand(term);
  });

program
  .command('plan [issue-key]')
  .description('Post a plan comment on the current issue')
  .argument('<summary>', 'Plan summary')
  .action(async (issueKey: string | undefined, summary: string) => {
    if (!summary) { summary = issueKey!; issueKey = undefined; }
    const { planCommand } = await import('./commands/sdk.js');
    await planCommand(issueKey, summary);
  });

// --- Company ---
const company = program.command('company').description('Fleet-level management');

company
  .command('start')
  .description('Start all agents on their Todo backlog')
  .action(async () => {
    const { companyStart } = await import('./commands/company.js');
    await companyStart();
  });

company
  .command('stop')
  .description('Gracefully stop all active sessions')
  .action(async () => {
    const { companyStop } = await import('./commands/company.js');
    companyStop();
  });

company
  .command('status')
  .description('Fleet overview — all agents, sessions, capacity')
  .action(async () => {
    const { companyStatus } = await import('./commands/company.js');
    companyStatus();
  });

// --- Doctor ---
program
  .command('doctor')
  .description('Run diagnostic checks on the ANC system')
  .action(async () => {
    const { doctorCommand } = await import('./commands/doctor.js');
    await doctorCommand();
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
