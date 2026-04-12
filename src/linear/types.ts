// Linear domain types — single source of truth for all type definitions

import { homedir } from 'os';
import { join } from 'path';

// --- Config ---

export interface AncConfig {
  linearTeamId: string;
  linearTeamKey: string;
  workspaceBase: string;
  stateDir: string;
  webhookPort: number;
  webhookSecret?: string;
}

const STATE_DIR = join(homedir(), '.anc');

export function getConfig(): AncConfig {
  return {
    linearTeamId: requireEnv('ANC_LINEAR_TEAM_ID'),
    linearTeamKey: requireEnv('ANC_LINEAR_TEAM_KEY'),
    workspaceBase: process.env.ANC_WORKSPACE_BASE || join(homedir(), 'anc-workspaces'),
    stateDir: STATE_DIR,
    webhookPort: Number(process.env.ANC_WEBHOOK_PORT) || 3849,
    webhookSecret: process.env.ANC_WEBHOOK_SECRET,
  };
}

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing env: ${name}. See config/env.example`);
  return val;
}

// --- Linear entities ---

export interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  description?: string;
  priority: number;
  labels: string[];
  status: IssueStatus;
  url: string;
  project?: string;
  delegateId?: string;
  assigneeId?: string;
  parentId?: string;
}

export type IssueStatus = 'Backlog' | 'Todo' | 'In Progress' | 'In Review' | 'Done' | 'Canceled' | 'Duplicate';

export const VALID_STATUSES: readonly IssueStatus[] = ['Backlog', 'Todo', 'In Progress', 'In Review', 'Done', 'Canceled', 'Duplicate'];

// --- Agent system ---

export type AgentRole = string;

export interface AgentConfig {
  name: string;
  role: AgentRole;
  model: 'claude-code';
  linearUserId: string;
  oauthTokenPath?: string;
  personaFiles: string[];
  maxConcurrency: number;   // parallel task sessions
  dutySlots: number;        // separate pool for proactive duties (never starved by tasks)
}

// --- Webhook payloads ---

export interface WebhookPayload {
  action: string;
  type: string;
  data: Record<string, unknown>;
  url?: string;
  webhookId?: string;
  createdAt?: string;
}

export interface CommentPayload {
  id: string;
  body: string;
  issueId: string;
  userId: string;
  parentId?: string;
}

export interface IssuePayload {
  id: string;
  identifier: string;
  title: string;
  description?: string;
  priority: number;
  labelIds?: string[];
  labels?: string[];
  stateId?: string;
  state?: string;
  projectId?: string;
  project?: string;
  assigneeId?: string;
  delegateId?: string;
  parentId?: string;
}

export interface SessionPayload {
  id: string;
  issueId: string;
  agentId: string;
  status: string;
  prompt?: string;
}

// --- Routing ---

export type RouteTarget = AgentRole | 'skip';

export interface RouteDecision {
  target: RouteTarget;
  reason: string;
  issueKey: string;
  priority: number;
}

// --- Task types for quality gates ---

export type TaskType = 'code' | 'strategy' | 'research' | 'ops' | 'trivial';

// --- Queue ---

export interface QueueItem {
  id: string;
  issueKey: string;
  issueId: string;
  agentRole: AgentRole;
  priority: number;
  context?: string;
  /** Unix epoch milliseconds */
  createdAt: number;
  status: 'queued' | 'processing' | 'completed' | 'canceled';
}
