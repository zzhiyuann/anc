// Agent types
export type AgentStatus = "active" | "idle" | "queued" | "failed" | "completed" | "suspended";

export interface Agent {
  role: string;
  name: string;
  status: AgentStatus;
  model: string;
  currentTask: string | null;
  currentIssueKey: string | null;
  uptime: number; // seconds
  memoryFiles: number;
  sessionCount: number;
  avatar: string; // emoji or URL
}

export interface AgentDetail extends Agent {
  description: string;
  outputLines: string[];
  memoryEntries: MemoryEntry[];
  sessions: SessionEntry[];
}

// Task types
export type TaskStatus = "backlog" | "todo" | "in_progress" | "in_review" | "done";
export type TaskPriority = "urgent" | "high" | "medium" | "low" | "none";

export interface Task {
  id: string;
  issueKey: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  agent: string | null;
  duration: number | null; // seconds
  createdAt: string;
  updatedAt: string;
}

// Memory types
export interface MemoryEntry {
  filename: string;
  content: string;
  updatedAt: string;
  sizeBytes: number;
}

// Session types
export interface SessionEntry {
  id: string;
  issueKey: string;
  startedAt: string;
  endedAt: string | null;
  status: "running" | "completed" | "failed" | "killed";
  duration: number; // seconds
}

// Event types
export type EventType =
  | "agent.started"
  | "agent.completed"
  | "agent.failed"
  | "agent.idle"
  | "task.created"
  | "task.assigned"
  | "task.completed"
  | "system.health"
  | "message.sent"
  | "message.received";

export interface AncEvent {
  id: string;
  type: EventType;
  agent: string | null;
  message: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

// Queue types
export interface QueueState {
  pending: number;
  running: number;
  completed: number;
  failed: number;
  items: QueueItem[];
}

export interface QueueItem {
  id: string;
  issueKey: string;
  agent: string;
  priority: TaskPriority;
  status: "pending" | "running" | "completed" | "failed";
  enqueuedAt: string;
}

// Health types
export interface SystemHealth {
  status: "healthy" | "degraded" | "unhealthy";
  uptime: number;
  agents: {
    total: number;
    active: number;
    idle: number;
    failed: number;
  };
  queue: {
    pending: number;
    running: number;
  };
  memory: {
    heapUsed: number;
    heapTotal: number;
  };
  version: string;
}

// WebSocket event
export interface WsEvent {
  type: string;
  data: unknown;
  timestamp: string;
}
