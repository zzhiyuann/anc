/**
 * Linear API client — typed wrapper with per-agent OAuth.
 * Single source of truth: Linear API. Local cache is disposable.
 */

import { LinearClient } from '@linear/sdk';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { getConfig, type LinearIssue, type AgentRole, VALID_STATUSES, type IssueStatus } from './types.js';

// --- Client cache ---

const clientCache = new Map<string, LinearClient>();

/** Get a read-only client using the system API key */
export function getSystemClient(): LinearClient {
  if (!clientCache.has('_system')) {
    const key = process.env.ANC_LINEAR_API_KEY;
    if (!key) throw new Error('Missing env: ANC_LINEAR_API_KEY');
    clientCache.set('_system', new LinearClient({ apiKey: key }));
  }
  return clientCache.get('_system')!;
}

/** Get a client authenticated as a specific agent (OAuth token) */
export function getAgentClient(role: AgentRole): LinearClient {
  const cacheKey = `agent:${role}`;
  if (!clientCache.has(cacheKey)) {
    const token = getAgentToken(role);
    if (!token) throw new Error(`No OAuth token for agent: ${role}. Run 'anc auth' first.`);
    clientCache.set(cacheKey, new LinearClient({ accessToken: token }));
  }
  return clientCache.get(cacheKey)!;
}

function getAgentToken(role: AgentRole): string | null {
  const config = getConfig();
  const tokenPath = join(config.stateDir, 'agents', role, '.oauth-token');
  if (existsSync(tokenPath)) {
    return readFileSync(tokenPath, 'utf-8').trim();
  }
  return null;
}

// --- Issue operations ---

export async function getIssue(identifier: string): Promise<LinearIssue | null> {
  const client = getSystemClient();
  try {
    const issue = await client.issue(identifier);
    if (!issue) return null;
    const state = await issue.state;
    const labels = await issue.labels();
    const project = await issue.project;
    const delegate = await issue.delegate;
    const assignee = await issue.assignee;
    const parent = await issue.parent;

    return {
      id: issue.id,
      identifier: issue.identifier,
      title: issue.title,
      description: issue.description ?? undefined,
      priority: issue.priority,
      labels: labels.nodes.map(l => l.name),
      status: (state?.name ?? 'Backlog') as IssueStatus,
      url: issue.url,
      project: project?.name,
      delegateId: delegate?.id,
      assigneeId: assignee?.id,
      parentId: parent?.id,
    };
  } catch {
    return null;
  }
}

export async function addComment(issueId: string, body: string, asAgent?: AgentRole): Promise<string | null> {
  const client = asAgent ? getAgentClient(asAgent) : getSystemClient();
  try {
    const comment = await client.createComment({ issueId, body });
    const created = await comment.comment;
    return created?.id ?? null;
  } catch (err) {
    console.error(`[linear] Failed to add comment:`, (err as Error).message);
    return null;
  }
}

export async function setIssueStatus(issueId: string, status: IssueStatus): Promise<boolean> {
  if (!VALID_STATUSES.includes(status)) {
    throw new Error(`Invalid status: "${status}". Valid: ${VALID_STATUSES.join(', ')}`);
  }
  const client = getSystemClient();
  try {
    const stateId = await getWorkflowStateId(status);
    if (!stateId) return false;
    await client.updateIssue(issueId, { stateId });
    return true;
  } catch (err) {
    console.error(`[linear] Failed to set status:`, (err as Error).message);
    return false;
  }
}

export async function createSubIssue(
  parentIdentifier: string,
  title: string,
  description: string,
  priority: number = 3,
  asAgent?: AgentRole,
): Promise<string | null> {
  const parent = await getIssue(parentIdentifier);
  if (!parent) throw new Error(`Parent issue not found: ${parentIdentifier}`);

  const client = asAgent ? getAgentClient(asAgent) : getSystemClient();
  const config = getConfig();
  try {
    const result = await client.createIssue({
      teamId: config.linearTeamId,
      title,
      description,
      priority,
      parentId: parent.id,
    });
    const created = await result.issue;
    return created?.identifier ?? null;
  } catch (err) {
    console.error(`[linear] Failed to create sub-issue:`, (err as Error).message);
    return null;
  }
}

// --- Workflow states ---

let stateCache: Map<string, string> | null = null;

async function getWorkflowStateId(name: string): Promise<string | null> {
  if (!stateCache) {
    stateCache = new Map();
    const client = getSystemClient();
    const config = getConfig();
    const team = await client.team(config.linearTeamId);
    const states = await team.states();
    for (const s of states.nodes) {
      stateCache.set(s.name, s.id);
    }
  }
  return stateCache.get(name) ?? null;
}

// --- Agent Session operations ---

export async function createAgentSession(issueId: string, asAgent: AgentRole): Promise<string | null> {
  const client = getAgentClient(asAgent);
  try {
    // Linear SDK's agent session API — use raw GraphQL
    const data = await (client as unknown as { _request: (query: string, variables: Record<string, unknown>) => Promise<Record<string, unknown>> })
      ._request(`mutation($input: AgentSessionCreateInput!) { agentSessionCreate(input: $input) { agentSession { id } } }`, { input: { issueId } });
    return (data as { agentSessionCreate: { agentSession: { id: string } } }).agentSessionCreate?.agentSession?.id ?? null;
  } catch (err) {
    console.error(`[linear] Failed to create agent session:`, (err as Error).message);
    return null;
  }
}

export async function emitActivity(
  sessionId: string,
  body: string,
  type: 'thought' | 'response' = 'thought',
  ephemeral: boolean = true,
  asAgent?: AgentRole,
): Promise<boolean> {
  const client = asAgent ? getAgentClient(asAgent) : getSystemClient();
  try {
    await (client as unknown as { createAgentActivity: (input: Record<string, unknown>) => Promise<unknown> })
      .createAgentActivity({ agentSessionId: sessionId, type, body, ephemeral: type === 'thought' ? ephemeral : false });
    return true;
  } catch {
    return false;
  }
}

export async function dismissSession(sessionId: string, asAgent?: AgentRole): Promise<boolean> {
  const client = asAgent ? getAgentClient(asAgent) : getSystemClient();
  try {
    await (client as unknown as { completeAgentSession: (id: string, input: Record<string, unknown>) => Promise<unknown> })
      .completeAgentSession(sessionId, { type: 'response', body: '–' });
    return true;
  } catch {
    return false;
  }
}

/** Clear cached clients (for testing) */
export function _resetClients(): void {
  clientCache.clear();
  stateCache = null;
}
