/**
 * Agent SDK CLI commands — run inside agent tmux sessions.
 *
 * Auth: uses AGENT_ROLE env → reads OAuth token from ~/.anc/agents/<role>/.oauth-token
 * Falls back to ANC_AGENT_TOKEN env var (Bearer token).
 * These commands ALWAYS post as the agent, never as CEO.
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const LINEAR_API = 'https://api.linear.app/graphql';

function getAgentRole(): string {
  const role = process.env.AGENT_ROLE;
  if (!role) throw new Error('AGENT_ROLE env not set. Are you running inside an agent session?');
  return role;
}

function getAgentToken(): string {
  // 1. Try env var (set by spawn script)
  const envToken = process.env.ANC_AGENT_TOKEN;
  if (envToken) return envToken.replace(/^Bearer\s+/i, '');

  // 2. Read from file
  const role = getAgentRole();
  const tokenPath = join(homedir(), '.anc', 'agents', role, '.oauth-token');
  if (existsSync(tokenPath)) return readFileSync(tokenPath, 'utf-8').trim();

  throw new Error(`No OAuth token for ${role}. Run 'anc setup' first.`);
}

function getIssueKey(explicit?: string): string {
  const key = explicit ?? process.env.ANC_ISSUE_KEY;
  if (!key) throw new Error('No issue key provided and ANC_ISSUE_KEY not set.');
  return key;
}

async function gql(query: string, variables?: Record<string, unknown>): Promise<Record<string, unknown>> {
  const token = getAgentToken();
  const res = await fetch(LINEAR_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json() as Record<string, unknown>;
  if ((json as { errors?: unknown[] }).errors) {
    const err = ((json as { errors: Array<{ message: string }> }).errors)[0];
    throw new Error(`Linear API: ${err.message}`);
  }
  return (json as { data: Record<string, unknown> }).data;
}

/** Resolve "ANC-66" identifier to UUID */
async function resolveIssueId(identifier: string): Promise<string> {
  const [teamKey, numStr] = identifier.split('-');
  const num = parseInt(numStr, 10);
  const data = await gql(
    `query($teamKey: String!, $num: Float!) { issues(filter: { team: { key: { eq: $teamKey } }, number: { eq: $num } }, first: 1) { nodes { id } } }`,
    { teamKey, num },
  );
  const nodes = (data as { issues: { nodes: Array<{ id: string }> } }).issues.nodes;
  if (!nodes.length) throw new Error(`Issue not found: ${identifier}`);
  return nodes[0].id;
}

// --- Commands ---

export async function commentCommand(issueKey: string | undefined, message: string): Promise<void> {
  const key = getIssueKey(issueKey);
  const issueId = await resolveIssueId(key);
  await gql(`mutation($input: CommentCreateInput!) { commentCreate(input: $input) { success } }`, {
    input: { issueId, body: message },
  });
  console.log(`✓ Comment posted on ${key} as ${getAgentRole()}`);
}

export async function readIssueCommand(issueKey: string | undefined): Promise<void> {
  const key = getIssueKey(issueKey);
  const [teamKey, numStr] = key.split('-');
  const num = parseInt(numStr, 10);
  const data = await gql(
    `query($teamKey: String!, $num: Float!) {
      issues(filter: { team: { key: { eq: $teamKey } }, number: { eq: $num } }, first: 1) {
        nodes {
          identifier title description state { name } priority
          assignee { name } delegate { name }
          parent { identifier title }
          labels { nodes { name } }
          comments { nodes { body createdAt user { name } } }
          children { nodes { identifier title state { name } assignee { name } } }
        }
      }
    }`,
    { teamKey, num },
  );
  const nodes = (data as { issues: { nodes: unknown[] } }).issues.nodes;
  if (!nodes.length) { console.error(`Issue not found: ${key}`); process.exit(1); }
  const issue = nodes[0] as Record<string, unknown>;

  // Print structured output the agent can parse
  console.log(`# ${issue.identifier}: ${issue.title}`);
  console.log(`State: ${(issue.state as Record<string, string>).name} | Priority: ${issue.priority}`);
  const labels = (issue.labels as { nodes: Array<{ name: string }> }).nodes;
  if (labels.length) console.log(`Labels: ${labels.map(l => l.name).join(', ')}`);
  const parent = issue.parent as Record<string, string> | null;
  if (parent) console.log(`Parent: ${parent.identifier} — ${parent.title}`);
  console.log();

  if (issue.description) {
    console.log('## Description');
    console.log(issue.description);
    console.log();
  }

  const children = (issue.children as { nodes: Array<Record<string, unknown>> }).nodes;
  if (children.length) {
    console.log('## Sub-issues');
    for (const ch of children) {
      const assignee = ch.assignee as Record<string, string> | null;
      console.log(`- ${ch.identifier} [${(ch.state as Record<string, string>).name}]${assignee ? ` (${assignee.name})` : ''}: ${ch.title}`);
    }
    console.log();
  }

  const comments = (issue.comments as { nodes: Array<Record<string, unknown>> }).nodes;
  if (comments.length) {
    console.log('## Comments');
    const sorted = comments.sort((a, b) =>
      (a.createdAt as string).localeCompare(b.createdAt as string));
    for (const c of sorted) {
      const user = (c.user as Record<string, string> | null)?.name ?? 'system';
      const date = (c.createdAt as string).split('T')[0];
      console.log(`### ${user} (${date})`);
      console.log(c.body);
      console.log();
    }
  }
}

export async function createSubCommand(
  parentKey: string | undefined,
  title: string,
  description: string,
): Promise<void> {
  const key = getIssueKey(parentKey);
  const parentId = await resolveIssueId(key);

  // Get team ID from parent issue
  const parentData = await gql(
    `query($id: String!) { issue(id: $id) { team { id } } }`,
    { id: parentId },
  );
  const teamId = ((parentData as { issue: { team: { id: string } } }).issue).team.id;

  // Get Todo state for this team
  const teamData = await gql(
    `query($id: String!) { team(id: $id) { states { nodes { id name } } } }`,
    { id: teamId },
  );
  const states = (teamData as { team: { states: { nodes: Array<{ id: string; name: string }> } } }).team.states.nodes;
  const todoState = states.find(s => s.name === 'Todo');

  const input: Record<string, unknown> = {
    teamId,
    title,
    description,
    parentId,
    ...(todoState ? { stateId: todoState.id } : {}),
  };

  const data = await gql(
    `mutation($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { identifier url } } }`,
    { input },
  );
  const created = (data as { issueCreate: { issue: { identifier: string; url: string } } }).issueCreate.issue;
  console.log(`✓ Created ${created.identifier}: ${title}`);
}

export async function searchCommand(term: string): Promise<void> {
  const data = await gql(
    `query($term: String!) { searchIssues(term: $term, first: 10) { nodes { identifier title state { name } assignee { name } } } }`,
    { term },
  );
  const nodes = (data as { searchIssues: { nodes: Array<Record<string, unknown>> } }).searchIssues.nodes;
  if (!nodes.length) { console.log('No results.'); return; }
  for (const issue of nodes) {
    const assignee = (issue.assignee as Record<string, string> | null)?.name ?? '';
    console.log(`${issue.identifier} [${(issue.state as Record<string, string>).name}]${assignee ? ` (${assignee})` : ''} — ${issue.title}`);
  }
}

export async function planCommand(issueKey: string | undefined, summary: string): Promise<void> {
  const key = getIssueKey(issueKey);
  const role = getAgentRole();
  const body = `**${role}** plan:\n\n${summary}`;
  const issueId = await resolveIssueId(key);
  await gql(`mutation($input: CommentCreateInput!) { commentCreate(input: $input) { success } }`, {
    input: { issueId, body },
  });
  console.log(`✓ Plan posted on ${key}`);
}
