/**
 * anc doctor — diagnostic health check for ANC system.
 * Validates environment, config, credentials, dependencies, and connectivity.
 */

import { existsSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { execSync } from 'child_process';
import chalk from 'chalk';

const STATE_DIR = join(homedir(), '.anc');
const PASS = chalk.green('✓');
const FAIL = chalk.red('✗');
const WARN = chalk.yellow('⚠');

interface CheckResult {
  label: string;
  status: 'pass' | 'fail' | 'warn';
  detail?: string;
}

function check(label: string, status: 'pass' | 'fail' | 'warn', detail?: string): CheckResult {
  return { label, status, detail };
}

function printResult(r: CheckResult): void {
  const icon = r.status === 'pass' ? PASS : r.status === 'fail' ? FAIL : WARN;
  const detail = r.detail ? chalk.dim(` — ${r.detail}`) : '';
  console.log(`  ${icon} ${r.label}${detail}`);
}

function binExists(name: string): string | null {
  try {
    return execSync(`which ${name}`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch {
    return null;
  }
}

// --- Check groups ---

function checkDirectories(): CheckResult[] {
  const results: CheckResult[] = [];

  const dirs = [
    { path: STATE_DIR, label: '~/.anc' },
    { path: join(STATE_DIR, 'agents', 'engineer', 'memory'), label: '~/.anc/agents/engineer/memory' },
    { path: join(STATE_DIR, 'agents', 'strategist', 'memory'), label: '~/.anc/agents/strategist/memory' },
    { path: join(STATE_DIR, 'agents', 'ops', 'memory'), label: '~/.anc/agents/ops/memory' },
    { path: join(STATE_DIR, 'shared-memory'), label: '~/.anc/shared-memory' },
    { path: join(STATE_DIR, 'logs'), label: '~/.anc/logs' },
  ];

  for (const d of dirs) {
    if (existsSync(d.path)) {
      results.push(check(d.label, 'pass'));
    } else {
      results.push(check(d.label, 'fail', 'missing — run anc setup'));
    }
  }

  const wsBase = process.env.ANC_WORKSPACE_BASE || join(homedir(), 'anc-workspaces');
  if (existsSync(wsBase)) {
    results.push(check(`Workspace base (${wsBase})`, 'pass'));
  } else {
    results.push(check(`Workspace base (${wsBase})`, 'warn', 'missing — will be created on first agent spawn'));
  }

  return results;
}

function checkEnvVars(): CheckResult[] {
  const results: CheckResult[] = [];

  const required: Array<{ name: string; sensitive?: boolean }> = [
    { name: 'ANC_LINEAR_API_KEY', sensitive: true },
    { name: 'ANC_LINEAR_TEAM_ID' },
    { name: 'ANC_LINEAR_TEAM_KEY' },
  ];

  const optional: Array<{ name: string; sensitive?: boolean }> = [
    { name: 'ANC_WEBHOOK_PORT' },
    { name: 'ANC_WEBHOOK_SECRET', sensitive: true },
    { name: 'ANC_WORKSPACE_BASE' },
    { name: 'ANC_DISCORD_BOT_TOKEN', sensitive: true },
    { name: 'ANC_DISCORD_CHANNEL_ID' },
    { name: 'ANC_TELEGRAM_BOT_TOKEN', sensitive: true },
    { name: 'ANC_TELEGRAM_CHAT_ID' },
  ];

  for (const v of required) {
    const val = process.env[v.name];
    if (val) {
      const display = v.sensitive ? val.slice(0, 8) + '...' : val;
      results.push(check(v.name, 'pass', display));
    } else {
      results.push(check(v.name, 'fail', 'required — not set'));
    }
  }

  for (const v of optional) {
    const val = process.env[v.name];
    if (val) {
      const display = v.sensitive ? val.slice(0, 8) + '...' : val;
      results.push(check(v.name, 'pass', display));
    } else {
      results.push(check(v.name, 'warn', 'optional — not set'));
    }
  }

  return results;
}

async function checkConfig(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const configDir = join(process.cwd(), 'config');
  const { parse: parseYaml } = await import('yaml');

  // agents.yaml
  const agentsPath = join(configDir, 'agents.yaml');
  if (existsSync(agentsPath)) {
    try {
      const raw = parseYaml(readFileSync(agentsPath, 'utf-8'));
      const agentCount = Object.keys(raw?.agents ?? {}).length;
      results.push(check('config/agents.yaml', 'pass', `${agentCount} agents defined`));

      // Check persona files exist
      for (const [role, cfg] of Object.entries(raw.agents) as Array<[string, Record<string, unknown>]>) {
        const files = [cfg.base as string, cfg.role as string, ...((cfg.protocols as string[]) ?? [])];
        for (const f of files) {
          const fullPath = join(process.cwd(), f);
          if (!existsSync(fullPath)) {
            results.push(check(`  ${role}: ${f}`, 'fail', 'persona file missing'));
          }
        }
      }
    } catch (err) {
      results.push(check('config/agents.yaml', 'fail', `parse error: ${(err as Error).message}`));
    }
  } else {
    results.push(check('config/agents.yaml', 'fail', 'missing'));
  }

  // routing.yaml
  const routingPath = join(configDir, 'routing.yaml');
  if (existsSync(routingPath)) {
    try {
      parseYaml(readFileSync(routingPath, 'utf-8'));
      results.push(check('config/routing.yaml', 'pass'));
    } catch (err) {
      results.push(check('config/routing.yaml', 'fail', `parse error: ${(err as Error).message}`));
    }
  } else {
    results.push(check('config/routing.yaml', 'fail', 'missing'));
  }

  return results;
}

function checkAgentTokens(): CheckResult[] {
  const results: CheckResult[] = [];
  const roles = ['engineer', 'strategist', 'ops'];

  for (const role of roles) {
    const tokenPath = join(STATE_DIR, 'agents', role, '.oauth-token');
    if (existsSync(tokenPath)) {
      const token = readFileSync(tokenPath, 'utf-8').trim();
      if (token.length > 0) {
        results.push(check(`${role} OAuth token`, 'pass', `${token.slice(0, 8)}...`));
      } else {
        results.push(check(`${role} OAuth token`, 'fail', 'file exists but empty'));
      }
    } else {
      results.push(check(`${role} OAuth token`, 'fail', `missing at ${tokenPath}`));
    }
  }

  return results;
}

async function checkDependencies(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  // tmux — use runner's resolved path (same logic the spawn code uses)
  try {
    const { getTmuxPath } = await import('../runtime/runner.js');
    const tmuxBin = getTmuxPath();
    try {
      const ver = execSync(`${tmuxBin} -V`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
      results.push(check('tmux', 'pass', `${ver} (${tmuxBin})`));
    } catch {
      results.push(check('tmux', 'pass', tmuxBin));
    }
  } catch {
    results.push(check('tmux', 'fail', 'not found — required for agent sessions. Install: brew install tmux'));
  }

  // claude (Claude Code CLI)
  const claudePath = binExists('claude');
  if (claudePath) {
    results.push(check('claude', 'pass', claudePath));
  } else {
    results.push(check('claude', 'fail', 'not found — required for agent execution'));
  }

  // node
  const nodePath = binExists('node');
  if (nodePath) {
    const ver = execSync('node --version', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    results.push(check('node', 'pass', ver));
  } else {
    results.push(check('node', 'fail', 'not found'));
  }

  // git
  const gitPath = binExists('git');
  if (gitPath) {
    const ver = execSync('git --version', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    results.push(check('git', 'pass', ver));
  } else {
    results.push(check('git', 'fail', 'not found — required for worktree management'));
  }

  return results;
}

async function checkDatabase(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const dbPath = join(STATE_DIR, 'state.db');

  if (existsSync(dbPath)) {
    const stats = statSync(dbPath);
    const sizeKb = Math.round(stats.size / 1024);
    results.push(check('state.db', 'pass', `${sizeKb} KB`));

    // Try to open and query
    try {
      const Database = (await import('better-sqlite3')).default;
      const db = new Database(dbPath, { readonly: true });
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>;
      const tableNames = tables.map((t: { name: string }) => t.name);
      const expected = ['sessions', 'queue', 'breakers', 'events'];
      for (const t of expected) {
        if (tableNames.includes(t)) {
          const count = (db.prepare(`SELECT COUNT(*) as c FROM ${t}`).get() as { c: number }).c;
          results.push(check(`  table: ${t}`, 'pass', `${count} rows`));
        } else {
          results.push(check(`  table: ${t}`, 'fail', 'missing'));
        }
      }
      db.close();
    } catch (err) {
      results.push(check('  database query', 'fail', (err as Error).message));
    }
  } else {
    results.push(check('state.db', 'warn', 'not created yet — will be created on first anc serve'));
  }

  return results;
}

async function checkLinearConnectivity(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const apiKey = process.env.ANC_LINEAR_API_KEY;

  if (!apiKey) {
    results.push(check('Linear API', 'fail', 'no API key set'));
    return results;
  }

  try {
    const res = await fetch('https://api.linear.app/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': apiKey },
      body: JSON.stringify({ query: '{ viewer { id name email } }' }),
      signal: AbortSignal.timeout(10_000),
    });
    const data = await res.json() as { data?: { viewer?: { name: string; email: string } } };
    if (data.data?.viewer) {
      results.push(check('Linear API', 'pass', `${data.data.viewer.name} (${data.data.viewer.email})`));
    } else {
      results.push(check('Linear API', 'fail', 'key invalid or expired'));
    }
  } catch (err) {
    results.push(check('Linear API', 'fail', `connection failed: ${(err as Error).message}`));
  }

  // Check team
  const teamId = process.env.ANC_LINEAR_TEAM_ID;
  if (teamId && apiKey) {
    try {
      const res = await fetch('https://api.linear.app/graphql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': apiKey },
        body: JSON.stringify({ query: `{ team(id: "${teamId}") { id name key } }` }),
        signal: AbortSignal.timeout(10_000),
      });
      const data = await res.json() as { data?: { team?: { name: string; key: string } } };
      if (data.data?.team) {
        results.push(check('Linear team', 'pass', `${data.data.team.name} (${data.data.team.key})`));
      } else {
        results.push(check('Linear team', 'fail', 'team ID not found'));
      }
    } catch {
      results.push(check('Linear team', 'fail', 'check failed'));
    }
  }

  return results;
}

async function checkGateway(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const port = process.env.ANC_WEBHOOK_PORT || '3849';

  try {
    const res = await fetch(`http://localhost:${port}/health`, {
      signal: AbortSignal.timeout(3_000),
    });
    const data = await res.json() as { status: string; uptime?: number };
    if (data.status === 'ok') {
      const uptime = data.uptime ? `uptime ${data.uptime}s` : '';
      results.push(check('Gateway', 'pass', `running on :${port} ${uptime}`.trim()));
    } else {
      results.push(check('Gateway', 'warn', `responded but status: ${data.status}`));
    }
  } catch {
    results.push(check('Gateway', 'warn', `not running on :${port}`));
  }

  return results;
}

async function checkTmuxSessions(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  try {
    const { getTmuxPath } = await import('../runtime/runner.js');
    const tmuxBin = getTmuxPath();
    const output = execSync(`${tmuxBin} list-sessions -F "#{session_name}"`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    if (output) {
      const sessions = output.split('\n');
      const ancSessions = sessions.filter(s => s.startsWith('anc-'));
      if (ancSessions.length > 0) {
        results.push(check('tmux sessions', 'pass', `${ancSessions.length} ANC sessions active`));
        for (const s of ancSessions) {
          results.push(check(`  ${s}`, 'pass'));
        }
      } else {
        results.push(check('tmux sessions', 'pass', `no ANC sessions (${sessions.length} total tmux sessions)`));
      }
    } else {
      results.push(check('tmux sessions', 'pass', 'no active sessions'));
    }
  } catch {
    results.push(check('tmux sessions', 'warn', 'tmux server not running'));
  }

  return results;
}

// --- Main ---

export async function doctorCommand(): Promise<void> {
  console.log(chalk.bold('\nANC Doctor — System Diagnostics\n'));

  const sections: Array<{ title: string; results: CheckResult[] | Promise<CheckResult[]> }> = [
    { title: 'Directories', results: checkDirectories() },
    { title: 'Environment Variables', results: checkEnvVars() },
    { title: 'Config Files', results: checkConfig() },
    { title: 'Agent Tokens', results: checkAgentTokens() },
    { title: 'Dependencies', results: checkDependencies() },
    { title: 'Database', results: checkDatabase() },
    { title: 'Linear Connectivity', results: checkLinearConnectivity() },
    { title: 'Gateway', results: checkGateway() },
    { title: 'Tmux Sessions', results: checkTmuxSessions() },
  ];

  let totalPass = 0;
  let totalFail = 0;
  let totalWarn = 0;

  for (const section of sections) {
    console.log(chalk.bold(`${section.title}`));
    const results = await section.results;
    for (const r of results) {
      printResult(r);
      if (r.status === 'pass') totalPass++;
      else if (r.status === 'fail') totalFail++;
      else totalWarn++;
    }
    console.log();
  }

  // Summary
  const parts: string[] = [];
  parts.push(chalk.green(`${totalPass} passed`));
  if (totalWarn > 0) parts.push(chalk.yellow(`${totalWarn} warnings`));
  if (totalFail > 0) parts.push(chalk.red(`${totalFail} failed`));
  console.log(chalk.bold('Summary: ') + parts.join(', '));

  if (totalFail > 0) {
    console.log(chalk.red('\nFix the failures above to ensure ANC operates correctly.'));
    console.log(chalk.dim('Run `anc setup` to create missing directories and config.\n'));
  } else if (totalWarn > 0) {
    console.log(chalk.yellow('\nAll critical checks passed. Warnings are non-blocking.\n'));
  } else {
    console.log(chalk.green('\nAll checks passed. System is healthy.\n'));
  }
}
