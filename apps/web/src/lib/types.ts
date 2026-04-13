// Types mirrored directly from the anc backend (src/api/routes.ts + src/api/ws.ts).
// These are the REAL API response shapes — do not freelance.

// --- Sessions (runtime/health.ts → TrackedSession) ---

export type SessionState = "active" | "idle" | "suspended";

export interface SessionSummary {
  issueKey: string;
  state: SessionState;
  /** Seconds since spawn. Only present for active sessions. */
  uptime?: number;
}

// --- Agents ---

/**
 * GET /api/v1/agents → { agents: AgentStatus[] }
 * GET /api/v1/agents/:role → AgentStatusDetail
 *
 * Built from getRegisteredAgents() + getHealthStatus() in routes.ts.
 */
export interface AgentStatus {
  role: string;
  name: string;
  hasCapacity: boolean;
  activeSessions: number;
  idleSessions: number;
  suspendedSessions: number;
  maxConcurrency: number;
  sessions: SessionSummary[];
}

/**
 * GET /api/v1/agents/:role → agent config + health + memoryCount
 * Shape: { ...AgentConfig, ...HealthStatus, memoryCount }
 */
export interface AgentStatusDetail extends AgentStatus {
  model: "claude-code";
  linearUserId: string;
  oauthTokenPath?: string;
  personaFiles: string[];
  dutySlots: number;
  memoryCount: number;
}

// --- Tasks (mapped from TrackedSession in routes.ts) ---

/**
 * GET /api/v1/tasks → { tasks: TaskRow[] }
 *
 * Each task row is the projection built in routes.ts:
 *   { id: issueKey, role, issueKey, state, priority, spawnedAt, isDuty, ceoAssigned }
 */
export interface TaskRow {
  id: string;
  role: string;
  issueKey: string;
  state: SessionState;
  priority: number;
  /** Unix epoch milliseconds. */
  spawnedAt: number;
  isDuty: boolean;
  ceoAssigned: boolean;
}

/**
 * GET /api/v1/tasks/:id → TrackedSession + { alive }
 */
export interface TaskDetail {
  role: string;
  issueKey: string;
  tmuxSession: string;
  state: SessionState;
  spawnedAt: number;
  suspendedAt?: number;
  idleSince?: number;
  priority: number;
  ceoAssigned: boolean;
  handoffProcessed: boolean;
  useContinue: boolean;
  isDuty: boolean;
  alive: boolean;
}

/**
 * POST /api/v1/tasks → { issueKey, action, ... }
 * action comes from resolveSession() — one of: 'spawned' | 'queued' | 'resumed' | 'blocked' | etc.
 */
export interface CreateTaskResponse {
  issueKey: string;
  action: string;
  [key: string]: unknown;
}

// --- Queue ---

/**
 * GET /api/v1/queue → { items: QueueItem[] }
 * Shape mirrors src/linear/types.ts QueueItem.
 */
export interface QueueItem {
  id: string;
  issueKey: string;
  issueId: string;
  agentRole: string;
  priority: number;
  context?: string;
  /** ISO timestamp string. */
  createdAt: string;
  status: "queued" | "processing" | "completed" | "canceled";
}

// --- Events (db.getRecentEvents) ---

/**
 * GET /api/v1/events → { events: EventRow[] }
 */
export interface EventRow {
  id: number;
  eventType: string;
  role?: string;
  issueKey?: string;
  detail?: string;
  /** SQLite datetime string: 'YYYY-MM-DD HH:MM:SS' in UTC. */
  createdAt: string;
}

// --- Memory ---

/**
 * GET /api/v1/agents/:role/memory → { role, files: string[] }
 * GET /api/v1/memory/shared → { files: string[] }
 *
 * Backend only returns filenames — content is not exposed through the API.
 */
export interface MemoryList {
  role?: string;
  files: string[];
}

// --- Agent output ---

/**
 * GET /api/v1/agents/:role/output → { outputs: AgentOutput[] }
 */
export interface AgentOutput {
  issueKey: string;
  tmuxSession: string;
  output: string;
}

// --- WebSocket envelope (src/api/ws.ts broadcast format) ---

/**
 * All WS messages share this envelope. The very first message after connect
 * is always { type: 'snapshot', data: WsSnapshot }.
 *
 * Subsequent messages use bus event names as `type`:
 *   agent:spawned, agent:completed, agent:failed, agent:idle,
 *   agent:suspended, agent:resumed, agent:health,
 *   queue:enqueued, queue:drain,
 *   system:budget-alert,
 *   webhook:issue.created, webhook:comment.created
 */
export interface WsMessage<T = unknown> {
  type: string;
  data: T;
  /** Server-side epoch ms timestamp. */
  ts: number;
}

/**
 * Snapshot payload sent on connect (src/api/ws.ts buildSnapshot()).
 */
export interface WsSnapshot {
  agents: AgentStatus[];
  sessions: Array<{
    role: string;
    issueKey: string;
    state: SessionState;
    spawnedAt: number;
    priority: number;
  }>;
  queue: QueueItem[];
  /** Seconds. */
  uptime: number;
}

// ============================================================================
// Wave 2C: First-class Task entity + Projects + Notifications
// ----------------------------------------------------------------------------
// These types match the new backend API from Wave 2A. The authoritative
// shapes live in src/core/tasks.ts and src/core/projects.ts. The full task
// detail response shape comes from `GET /api/v1/tasks/:id` (see plan doc).
// ============================================================================

// --- First-class Task entity (src/core/tasks.ts) ---

export type TaskEntityState =
  | "todo"
  | "running"
  | "review"
  | "done"
  | "failed"
  | "canceled";

export type TaskSource = "dashboard" | "linear" | "dispatch" | "duty";

export interface Task {
  id: string;
  projectId: string | null;
  title: string;
  description: string | null;
  state: TaskEntityState;
  priority: number;
  source: TaskSource;
  parentTaskId: string | null;
  createdBy: string;
  linearIssueKey: string | null;
  /** Unix epoch milliseconds. */
  createdAt: number;
  completedAt: number | null;
  handoffSummary: string | null;
  // --- Wave A optional UI extensions (Linear-parity rebuild) ---
  /** Optional assignee role (e.g. "engineer"). UI-only until backend supports it. */
  assignee?: string | null;
  /** Optional flat label list. UI-only fallback. */
  labels?: string[];
  /** Optional ISO date (yyyy-mm-dd). UI-only until backend supports it. */
  dueDate?: string | null;
}

/** Patch shape accepted by `tasks.update`. Backend may not honor every field yet. */
export interface TaskUpdateInput {
  title?: string;
  description?: string | null;
  state?: TaskEntityState;
  priority?: number;
  projectId?: string | null;
  assignee?: string | null;
  labels?: string[];
  dueDate?: string | null;
}

// --- Projects (src/core/projects.ts) ---

export type ProjectState = "active" | "paused" | "archived";

/**
 * Linear-style project health. Backend gap (Wave B): not yet stored in the
 * Project schema — the dashboard persists this client-side until the backend
 * adds a `health` column. See apps/web/src/components/projects/local-meta.ts.
 */
export type ProjectHealth = "on-track" | "at-risk" | "off-track" | "no-update";

export interface Project {
  id: string;
  name: string;
  description: string | null;
  color: string;
  icon: string | null;
  state: ProjectState;
  createdBy: string;
  createdAt: number;
  archivedAt: number | null;
  // Wave B: Linear-style metadata persisted by the backend (Functional 2).
  health?: ProjectHealth;
  priority?: number;
  lead?: string | null;
  targetDate?: string | null;
}

/** Patch shape accepted by `projects.update`. */
export interface ProjectUpdateInput {
  name?: string;
  description?: string | null;
  color?: string;
  icon?: string | null;
  state?: ProjectState;
  health?: ProjectHealth;
  priority?: number;
  lead?: string | null;
  targetDate?: string | null;
}

export interface ProjectStats {
  total: number;
  running: number;
  queued: number;
  done: number;
  totalCostUsd: number;
}

export interface ProjectWithStats extends Project {
  stats: ProjectStats;
}

// --- Sessions (multi-agent: a task may have many sessions) ---

/** A session attached to a task as returned in TaskFull.sessions. */
export interface SessionOnTask {
  issueKey: string;
  role: string;
  state: "active" | "idle" | "suspended";
  tmuxSession: string | null;
  spawnedAt: number;
  alive: boolean;
}

// --- Task events / comments / attachments / cost / handoff ---

export interface TaskEvent {
  id: number;
  taskId: string;
  role: string | null;
  type: string;
  /** Parsed JSON payload (server already does JSON.parse). */
  payload: unknown;
  createdAt: number;
}

export interface TaskComment {
  id: number;
  taskId: string;
  /** 'ceo' | 'agent:<role>' */
  author: string;
  body: string;
  parentId: number | null;
  createdAt: number;
}

export type TaskAttachmentKind =
  | "handoff"
  | "retro"
  | "suspend"
  | "code"
  | "memory"
  | "other"
  // Backend (workspace listing) classifies files structurally:
  | "text"
  | "json"
  | "image"
  | "binary"
  | "dir";

export interface TaskAttachment {
  name: string;
  size: number;
  mtime: number;
  kind: TaskAttachmentKind;
}

export interface TaskCostByAgent {
  role: string;
  usd: number;
  tokens: number;
}

export interface TaskCost {
  totalUsd: number;
  byAgent: TaskCostByAgent[];
}

/** Parsed Actions block from a HANDOFF.md */
export interface ParsedActions {
  status?: string;
  dispatches?: Array<{
    role: string;
    context: string;
    newIssue?: string;
    project?: string;
  }>;
  delegate?: string;
  parentStatus?: string;
}

export interface TaskHandoff {
  body: string;
  actions: ParsedActions | null;
}

/**
 * Full task detail — the response shape of `GET /api/v1/tasks/:id`.
 * See plan doc "API Response Shape" for the spec.
 */
export interface TaskFull {
  task: Task;
  sessions: SessionOnTask[];
  events: TaskEvent[];
  comments: TaskComment[];
  attachments: TaskAttachment[];
  cost: TaskCost;
  children: Task[];
  handoff: TaskHandoff | null;
}

// --- Notifications ---

export type NotificationKind =
  | "mention"
  | "alert"
  | "briefing"
  | "completion"
  | "failure"
  | "dispatch"
  | "queue"
  | "budget"
  | "a2a";

export type NotificationSeverity = "info" | "warning" | "critical";

export interface AncNotification {
  id: number;
  kind: NotificationKind;
  severity: NotificationSeverity;
  title: string;
  body: string | null;
  taskId: string | null;
  projectId: string | null;
  agentRole: string | null;
  /** null = unread */
  readAt: number | null;
  /** null = active (not archived) */
  archivedAt: number | null;
  createdAt: number;
}

// --- Process events (Wave 2B live agent activity stream) ---

/**
 * Single-line UI summary of an in-flight agent action, broadcast over WS as
 * `agent:process-event`. The dashboard renders these as a "live activity"
 * feed scoped to one task.
 */
export interface ProcessEvent {
  taskId: string;
  role: string;
  /** e.g. 'agent:tool-call-start', 'agent:bash-command', 'agent:file-edit' */
  eventType: string;
  /** One-line human-readable summary, already truncated by the backend. */
  preview: string;
  ts: number;
}

// ============================================================================
// Wave F: /pulse surface — OKRs, Decision Log, Kill Switch, Daily Briefing.
// Backend lives in src/core/{objectives,decisions,kill-switch}.ts and is
// wired into src/api/routes.ts by the parent agent.
// ============================================================================

export interface KeyResult {
  id: string;
  objectiveId: string;
  title: string;
  metric: string;
  target: number;
  current: number;
  createdAt: number;
}

export interface Objective {
  id: string;
  title: string;
  /** e.g. "2026 Q2" */
  quarter: string;
  createdAt: number;
  keyResults: KeyResult[];
}

export interface Decision {
  id: string;
  title: string;
  rationale: string;
  /** "ceo" | "agent:<role>" */
  decidedBy: string;
  tags: string[];
  /** Unix epoch milliseconds. */
  createdAt: number;
}

export interface DailyBriefing {
  generatedAt: number;
  yesterdayCompletions: string[];
  todayQueue: string[];
  costBurn: { spentUsd: number; budgetUsd: number };
  wins: string[];
  risks: string[];
}

// --- Budget config (for the settings page) ---

export interface BudgetConfig {
  daily: { limit: number; alertAt: number };
  agents: Record<string, { limit: number; alertAt: number }>;
}

export type BudgetConfigPatch = {
  daily?: Partial<BudgetConfig['daily']>;
  agents?: Record<string, { limit: number; alertAt: number } | null>;
};

export interface BudgetConfigResponse {
  config: BudgetConfig;
  disabled: boolean;
  summary: {
    today: { spent: number; limit: number };
    perAgent: Record<string, { spent: number; limit: number }>;
  };
}

// --- Review config (for the settings page) ---

export interface ReviewConfigResponse {
  config: {
    default: string;
    roles: Record<string, string>;
    projects: Record<string, string>;
  };
  resolvedDefault: string;
}
