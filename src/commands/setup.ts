/**
 * anc setup — initialize ANC for a new Linear team.
 * Creates directory structure, validates API key, writes .env.
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import chalk from 'chalk';

const STATE_DIR = join(homedir(), '.anc');

export async function setupCommand(): Promise<void> {
  console.log(chalk.bold('\nANC Setup\n'));

  // 1. Create directory structure
  const dirs = [
    STATE_DIR,
    join(STATE_DIR, 'agents', 'engineer', 'memory'),
    join(STATE_DIR, 'agents', 'strategist', 'memory'),
    join(STATE_DIR, 'agents', 'ops', 'memory'),
    join(STATE_DIR, 'shared-memory'),
    join(STATE_DIR, 'logs'),
  ];

  for (const dir of dirs) {
    mkdirSync(dir, { recursive: true });
  }
  console.log(chalk.green('  Created ~/.anc/ directory structure'));

  // 2. Check for .env
  const envPath = join(process.cwd(), '.env');
  const envExamplePath = join(process.cwd(), 'config', 'env.example');

  if (!existsSync(envPath)) {
    if (existsSync(envExamplePath)) {
      const example = readFileSync(envExamplePath, 'utf-8');
      writeFileSync(envPath, example, 'utf-8');
      console.log(chalk.yellow('  Created .env from template — edit it with your credentials'));
    } else {
      writeFileSync(envPath, `# ANC Configuration
ANC_LINEAR_API_KEY=
ANC_LINEAR_TEAM_ID=
ANC_LINEAR_TEAM_KEY=
ANC_WEBHOOK_PORT=3849
ANC_WORKSPACE_BASE=${join(homedir(), 'anc-workspaces')}
`, 'utf-8');
      console.log(chalk.yellow('  Created .env — edit it with your credentials'));
    }
  } else {
    console.log(chalk.dim('  .env already exists'));
  }

  // 3. Validate Linear API key if set
  const apiKey = process.env.ANC_LINEAR_API_KEY;
  if (apiKey) {
    try {
      const res = await fetch('https://api.linear.app/graphql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': apiKey },
        body: JSON.stringify({ query: '{ viewer { id name email } }' }),
      });
      const data = await res.json() as { data?: { viewer?: { name: string; email: string } } };
      if (data.data?.viewer) {
        console.log(chalk.green(`  Linear API: authenticated as ${data.data.viewer.name} (${data.data.viewer.email})`));
      } else {
        console.log(chalk.red('  Linear API: key invalid or expired'));
      }
    } catch (err) {
      console.log(chalk.red(`  Linear API: connection failed — ${(err as Error).message}`));
    }
  } else {
    console.log(chalk.yellow('  Linear API: key not set — edit .env'));
  }

  // 4. Check team ID
  const teamId = process.env.ANC_LINEAR_TEAM_ID;
  if (teamId && apiKey) {
    try {
      const res = await fetch('https://api.linear.app/graphql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': apiKey },
        body: JSON.stringify({ query: `{ team(id: "${teamId}") { id name key } }` }),
      });
      const data = await res.json() as { data?: { team?: { name: string; key: string } } };
      if (data.data?.team) {
        console.log(chalk.green(`  Linear team: ${data.data.team.name} (${data.data.team.key})`));
      } else {
        console.log(chalk.red('  Linear team: team ID not found'));
      }
    } catch {
      console.log(chalk.red('  Linear team: check failed'));
    }
  }

  // 5. Check agent OAuth tokens
  const roles = ['engineer', 'strategist', 'ops'];
  for (const role of roles) {
    const tokenPath = join(STATE_DIR, 'agents', role, '.oauth-token');
    if (existsSync(tokenPath)) {
      console.log(chalk.green(`  ${role}: OAuth token found`));
    } else {
      console.log(chalk.yellow(`  ${role}: No OAuth token at ${tokenPath}`));
    }
  }

  // 6. Check workspace base
  const wsBase = process.env.ANC_WORKSPACE_BASE || join(homedir(), 'anc-workspaces');
  mkdirSync(wsBase, { recursive: true });
  console.log(chalk.green(`  Workspaces: ${wsBase}`));

  // 7. Check SQLite DB
  const dbPath = join(STATE_DIR, 'state.db');
  if (existsSync(dbPath)) {
    console.log(chalk.dim('  Database: exists'));
  } else {
    console.log(chalk.dim('  Database: will be created on first run'));
  }

  console.log(chalk.bold('\nSetup complete. Next steps:'));
  console.log('  1. Edit .env with your Linear API key and team ID');
  console.log('  2. Set up agent OAuth tokens (see docs)');
  console.log('  3. Run: anc serve');
  console.log('');
}
