/**
 * Agent SDK — typed CLI that agents use to interact with Linear and other agents.
 * Replaces linear-tool.sh with validation, type safety, and no shell escaping.
 */

import { VALID_STATUSES, type IssueStatus } from '../linear/types.js';
import { loadRoutingConfig } from '../routing/rules.js';

const SERVER_URL = process.env.ANC_SERVER_URL || 'http://localhost:3849';
const ROLE = process.env.AGENT_ROLE || 'unknown';

// --- HTTP helpers ---

async function post(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch(`${SERVER_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return await res.json() as Record<string, unknown>;
}

async function linearGraphQL(query: string, variables: Record<string, unknown> = {}): Promise<unknown> {
  // Use the agent's OAuth token directly for Linear API calls
  const token = process.env.ANC_AGENT_TOKEN;
  if (!token) throw new Error('ANC_AGENT_TOKEN not set. Agent SDK requires auth.');

  const res = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': token,
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json() as Record<string, unknown>;
  if ((json as Record<string, unknown>).errors) {
    throw new Error(`Linear API error: ${JSON.stringify((json as Record<string, unknown>).errors)}`);
  }
  return (json as Record<string, unknown>).data;
}

// --- SDK commands ---

/** Post a comment on an issue */
export async function comment(issueKey: string, body: string): Promise<void> {
  if (!body || body.trim().length === 0) throw new Error('Comment body cannot be empty');
  if (/^--[a-z]/i.test(body.trim())) throw new Error(`Body looks like a flag: "${body}". Did you mean a different command?`);

  // Resolve issue ID from key
  const data = await linearGraphQL(`
    query($key: String!) { issue(id: $key) { id } }
  `, { key: issueKey }) as { issue: { id: string } };

  await linearGraphQL(`
    mutation($input: CommentCreateInput!) { commentCreate(input: $input) { success } }
  `, { input: { issueId: data.issue.id, body } });

  console.log(`Commented on ${issueKey}`);
}

/** Dispatch another agent to work on an issue */
export async function dispatch(targetRole: string, issueKey: string, context?: string): Promise<void> {
  validateRole(targetRole);
  const result = await post('/dispatch', { from: ROLE, target: targetRole, issueKey, context, type: 'dispatch' });
  if (!result.ok) throw new Error(result.detail as string);
  console.log(`Dispatched ${targetRole} on ${issueKey}`);
}

/** Handoff: you finish, target agent continues on the same issue */
export async function handoff(targetRole: string, issueKey: string, context: string): Promise<void> {
  validateRole(targetRole);
  const result = await post('/dispatch', { from: ROLE, target: targetRole, issueKey, context, type: 'handoff' });
  if (!result.ok) throw new Error(result.detail as string);
  console.log(`Handed off to ${targetRole} on ${issueKey}`);
}

/** Ask another agent a question (async — they respond when available) */
export async function ask(targetRole: string, issueKey: string, question: string): Promise<void> {
  validateRole(targetRole);
  const result = await post('/dispatch', { from: ROLE, target: targetRole, issueKey, context: `[Question from ${ROLE}] ${question}`, type: 'ask' });
  if (!result.ok) throw new Error(result.detail as string);
  console.log(`Asked ${targetRole}: ${question.substring(0, 60)}...`);
}

/** Change issue status */
export async function setStatus(issueKey: string, status: string): Promise<void> {
  if (!VALID_STATUSES.includes(status as IssueStatus)) {
    throw new Error(`Invalid status: "${status}". Valid: ${VALID_STATUSES.join(', ')}`);
  }
  // Resolve issue and state IDs, then update
  const data = await linearGraphQL(`
    query($key: String!) {
      issue(id: $key) { id, team { id, states { nodes { id, name } } } }
    }
  `, { key: issueKey }) as { issue: { id: string; team: { states: { nodes: { id: string; name: string }[] } } } };

  const stateNode = data.issue.team.states.nodes.find((s: { name: string }) => s.name === status);
  if (!stateNode) throw new Error(`Status "${status}" not found in team workflow`);

  await linearGraphQL(`
    mutation($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { success } }
  `, { id: data.issue.id, input: { stateId: stateNode.id } });

  console.log(`${issueKey} → ${status}`);
}

/** Create a sub-issue (always linked to parent) */
export async function createSub(parentKey: string, title: string, description: string, priority: number = 3): Promise<void> {
  if (!title) throw new Error('Title is required');

  const parent = await linearGraphQL(`
    query($key: String!) { issue(id: $key) { id, team { id } } }
  `, { key: parentKey }) as { issue: { id: string; team: { id: string } } };

  const result = await linearGraphQL(`
    mutation($input: IssueCreateInput!) { issueCreate(input: $input) { success, issue { identifier } } }
  `, {
    input: {
      teamId: parent.issue.team.id,
      title,
      description,
      priority,
      parentId: parent.issue.id,
    },
  }) as { issueCreate: { issue: { identifier: string } } };

  console.log(`Created ${result.issueCreate.issue.identifier} under ${parentKey}`);
}

/** Show team status — who's working on what */
export async function teamStatus(): Promise<void> {
  const res = await fetch(`${SERVER_URL}/status`);
  const data = await res.json() as { agents: Array<{ role: string; active: boolean; issueKey?: string; uptime?: number }> };
  for (const agent of data.agents) {
    const status = agent.active ? `working on ${agent.issueKey} (${agent.uptime}s)` : 'idle';
    console.log(`  ${agent.role}: ${status}`);
  }
}

/** Post to company Discord */
export async function group(message: string): Promise<void> {
  await post('/group-post', { role: ROLE, message });
  console.log(`Posted to group`);
}

/** Reply to a specific comment (threaded) */
export async function reply(issueKey: string, commentId: string, body: string): Promise<void> {
  if (!body || body.trim().length === 0) throw new Error('Reply body cannot be empty');

  await linearGraphQL(`
    mutation($input: CommentCreateInput!) { commentCreate(input: $input) { success } }
  `, { input: { issueId: issueKey, body, parentId: commentId } });

  console.log(`Replied on ${issueKey}`);
}

/** Search issues by text */
export async function search(query: string): Promise<void> {
  const data = await linearGraphQL(`
    query($query: String!) {
      searchIssues(term: $query, first: 10) {
        nodes { identifier, title, state { name }, assignee { name } }
      }
    }
  `, { query }) as { searchIssues: { nodes: Array<{ identifier: string; title: string; state: { name: string }; assignee?: { name: string } }> } };

  for (const issue of data.searchIssues.nodes) {
    const assignee = issue.assignee?.name ?? 'unassigned';
    console.log(`  ${issue.identifier} [${issue.state.name}] ${issue.title} (${assignee})`);
  }
}

/** List issues by status */
export async function listIssues(status?: string): Promise<void> {
  const filter: Record<string, unknown> = {};
  if (status) {
    filter.state = { name: { eq: status } };
  }

  const data = await linearGraphQL(`
    query($filter: IssueFilter) {
      issues(filter: $filter, first: 20, orderBy: updatedAt) {
        nodes { identifier, title, state { name }, priority, assignee { name } }
      }
    }
  `, { filter }) as { issues: { nodes: Array<{ identifier: string; title: string; state: { name: string }; priority: number; assignee?: { name: string } }> } };

  for (const issue of data.issues.nodes) {
    const assignee = issue.assignee?.name ?? 'unassigned';
    console.log(`  ${issue.identifier} [${issue.state.name}] P${issue.priority} ${issue.title} (${assignee})`);
  }
}

// --- Validation ---

function validateRole(role: string): void {
  const config = loadRoutingConfig();
  if (!config.agent_roles.includes(role.toLowerCase())) {
    throw new Error(`Unknown role: "${role}". Known: ${config.agent_roles.join(', ')}`);
  }
}
