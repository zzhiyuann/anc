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
