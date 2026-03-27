/**
 * Linear API client — typed wrapper with per-agent OAuth.
 * Single source of truth: Linear API. Local cache is disposable.
 */

import { LinearClient, LinearDocument } from '@linear/sdk';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { getConfig, type LinearIssue, type AgentRole, VALID_STATUSES, type IssueStatus } from './types.js';
import { createLogger } from '../core/logger.js';
import { withRateLimit } from './rate-limiter.js';

const log = createLogger('linear');

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
    // Linear SDK's issue() takes UUID. For identifiers (ANC-13), parse and use number filter.
    let issue;
    if (identifier.match(/^[A-Z]+-\d+$/)) {
      const [teamKey, numStr] = identifier.split('-');
      const num = parseInt(numStr, 10);
      const config = getConfig();
      const results = await withRateLimit(() => client.issues({
        filter: { team: { key: { eq: teamKey } }, number: { eq: num } },
        first: 1,
      }));
      issue = results.nodes[0];
    } else {
      issue = await withRateLimit(() => client.issue(identifier));
    }
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

export async function addComment(issueIdOrKey: string, body: string, asAgent?: AgentRole): Promise<string | null> {
  const client = asAgent ? getAgentClient(asAgent) : getSystemClient();
  try {
    // Resolve identifier (ANC-4) to UUID if needed
    let issueId = issueIdOrKey;
    if (issueIdOrKey.match(/^[A-Z]+-\d+$/)) {
      const issue = await getIssue(issueIdOrKey);
      if (!issue) {
        log.warn(`Issue not found: ${issueIdOrKey}`);
        return null;
      }
      issueId = issue.id;
    }
    const comment = await withRateLimit(() => client.createComment({ issueId, body }));
    const created = await comment.comment;
    return created?.id ?? null;
  } catch (err) {
    log.error(`Failed to add comment on ${issueIdOrKey}: ${(err as Error).message}`);
    return null;
  }
}

export async function setIssueStatus(issueId: string, status: IssueStatus, asAgent?: AgentRole): Promise<boolean> {
  if (!VALID_STATUSES.includes(status)) {
    throw new Error(`Invalid status: "${status}". Valid: ${VALID_STATUSES.join(', ')}`);
  }
  // Use agent client if available — status change shows as "Engineer moved..." instead of "Zhiyuan Wang moved..."
  const client = asAgent ? getAgentClient(asAgent) : getSystemClient();
  try {
    const stateId = await getWorkflowStateId(status);
    if (!stateId) return false;
    await withRateLimit(() => client.updateIssue(issueId, { stateId }));
    return true;
  } catch (err) {
    log.error(`Failed to set status: ${(err as Error).message}`);
    return false;
  }
}

export async function createIssue(
  title: string,
  description: string,
  labelNames?: string[],
): Promise<{ id: string; identifier: string } | null> {
  const client = getSystemClient();
  const config = getConfig();
  try {
    const input: Record<string, unknown> = {
      teamId: config.linearTeamId,
      title,
      description,
    };

    // Resolve label names to IDs
    if (labelNames?.length) {
      const labels = await withRateLimit(() => client.issueLabels({ filter: { team: { id: { eq: config.linearTeamId } } } }));
      const labelIds = labels.nodes
        .filter(l => labelNames.includes(l.name))
        .map(l => l.id);
      if (labelIds.length) input.labelIds = labelIds;
    }

    const result = await withRateLimit(() => client.createIssue(input as Parameters<typeof client.createIssue>[0]));
    const created = await result.issue;
    if (!created) return null;
    return { id: created.id, identifier: created.identifier };
  } catch (err) {
    log.error(`Failed to create issue: ${(err as Error).message}`);
    return null;
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

  // Resolve target agent's Linear user ID for delegate assignment
  let delegateId: string | undefined;
  if (asAgent) {
    const { getAgent } = await import('../agents/registry.js');
    const agent = getAgent(asAgent);
    delegateId = agent?.linearUserId;
  }

  // Get Todo state so sub-issues start ready for pickup (not Backlog)
  const todoStateId = await getWorkflowStateId('Todo');

  try {
    // Note: use delegateId (not assigneeId) — Linear's assigneeId doesn't work for app users
    const createInput: Record<string, unknown> = {
      teamId: config.linearTeamId,
      title,
      description,
      priority,
      parentId: parent.id,
      ...(todoStateId ? { stateId: todoStateId } : {}),
    };
    const result = await withRateLimit(() => client.createIssue(createInput as Parameters<typeof client.createIssue>[0]));

    // Force Todo state + delegate via updateIssue (createIssue sometimes ignores stateId)
    const created = await result.issue;
    if (created) {
      const forceUpdate: Record<string, unknown> = {};
      const todoState = await getWorkflowStateId('Todo');
      if (todoState) forceUpdate.stateId = todoState;
      if (delegateId) forceUpdate.delegateId = delegateId;
      if (Object.keys(forceUpdate).length > 0) {
        try {
          await withRateLimit(() => client.updateIssue(created.id, forceUpdate as Parameters<typeof client.updateIssue>[1]));
        } catch { /**/ }
      }
    }
    return created?.identifier ?? null;
  } catch (err) {
    log.error(`Failed to create sub-issue: ${(err as Error).message}`);
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
  // Use direct fetch instead of SDK _request (SDK may intercept the mutation)
  const tokenPath = join(homedir(), '.anc', 'agents', asAgent, '.oauth-token');
  if (!existsSync(tokenPath)) return null;
  const token = readFileSync(tokenPath, 'utf-8').trim();

  try {
    const res = await fetch('https://api.linear.app/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({
        query: `mutation($input: AgentSessionCreateOnIssue!) { agentSessionCreateOnIssue(input: $input) { success agentSession { id } } }`,
        variables: { input: { issueId } },
      }),
    });
    const json = await res.json() as Record<string, unknown>;
    if ((json as { errors?: unknown[] }).errors) {
      log.error(`AgentSession error: ${JSON.stringify((json as { errors: unknown[] }).errors[0])}`);
      return null;
    }
    return ((json as { data: { agentSessionCreateOnIssue: { agentSession: { id: string } } } }).data)
      .agentSessionCreateOnIssue?.agentSession?.id ?? null;
  } catch (err) {
    log.error(`Failed to create agent session: ${(err as Error).message}`);
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

// --- Scheduler queries ---

export async function getIssuesByRole(role: AgentRole, status: IssueStatus): Promise<LinearIssue[]> {
  const { getAgent } = await import('../agents/registry.js');
  const agent = getAgent(role);
  if (!agent?.linearUserId) return [];

  const client = getSystemClient();
  const stateId = await getWorkflowStateId(status);
  if (!stateId) return [];

  try {
    const issues = await withRateLimit(() => client.issues({
      filter: {
        assignee: { id: { eq: agent.linearUserId } },
        state: { id: { eq: stateId } },
      },
      first: 10,
    }));

    return issues.nodes.map(i => ({
      id: i.id,
      identifier: i.identifier,
      title: i.title,
      priority: i.priority,
      labels: [],
      status,
      url: i.url,
    }));
  } catch { return []; }
}

export async function getUnassignedTodoIssues(): Promise<LinearIssue[]> {
  const client = getSystemClient();
  const config = getConfig();
  const stateId = await getWorkflowStateId('Todo');
  if (!stateId) return [];

  try {
    // Get ALL Todo issues for the team (the scheduler will route them)
    const issues = await withRateLimit(() => client.issues({
      filter: {
        team: { id: { eq: config.linearTeamId } },
        state: { id: { eq: stateId } },
      },
      first: 10,
      orderBy: LinearDocument.PaginationOrderBy.UpdatedAt,
    }));

    return issues.nodes.map(i => ({
      id: i.id,
      identifier: i.identifier,
      title: i.title,
      priority: i.priority,
      labels: [],
      status: 'Todo' as IssueStatus,
      url: i.url,
    }));
  } catch { return []; }
}

export async function getIssuesByStatus(status: IssueStatus): Promise<LinearIssue[]> {
  const client = getSystemClient();
  const config = getConfig();
  const stateId = await getWorkflowStateId(status);
  if (!stateId) return [];

  try {
    const issues = await withRateLimit(() => client.issues({
      filter: {
        team: { id: { eq: config.linearTeamId } },
        state: { id: { eq: stateId } },
      },
      first: 50,
    }));

    return issues.nodes.map(i => ({
      id: i.id,
      identifier: i.identifier,
      title: i.title,
      priority: i.priority,
      labels: [],
      status,
      url: i.url,
    }));
  } catch { return []; }
}

/** Clear cached clients (for testing) */
export function _resetClients(): void {
  clientCache.clear();
  stateCache = null;
}
