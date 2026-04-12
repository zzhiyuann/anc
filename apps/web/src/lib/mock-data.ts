/**
 * Mock data used in dev mode until the anc backend is running on :3848.
 * Shapes match src/api/routes.ts exactly — see src/lib/types.ts.
 *
 * Timestamps are computed relative to Date.now() at import time so the UI
 * doesn't drift into "100 days ago" during long dev sessions.
 */

import type {
  AgentStatus,
  AgentStatusDetail,
  TaskRow,
  TaskDetail,
  QueueItem,
  EventRow,
  AgentOutput,
  WsSnapshot,
} from "./types";

const now = Date.now();
const minutes = (n: number) => now - n * 60_000;
const hours = (n: number) => now - n * 3_600_000;

function sqliteDatetime(ms: number): string {
  // Matches SQLite's datetime('now') output: 'YYYY-MM-DD HH:MM:SS' (UTC).
  return new Date(ms).toISOString().slice(0, 19).replace("T", " ");
}

function isoDatetime(ms: number): string {
  return new Date(ms).toISOString();
}

// --- Agents ---

export const mockAgents: AgentStatus[] = [
  {
    role: "engineer",
    name: "Engineer",
    hasCapacity: true,
    activeSessions: 1,
    idleSessions: 1,
    suspendedSessions: 0,
    maxConcurrency: 5,
    sessions: [
      { issueKey: "ANC-42", state: "active", uptime: 7234 },
      { issueKey: "ANC-38", state: "idle" },
    ],
  },
  {
    role: "strategist",
    name: "Strategist",
    hasCapacity: true,
    activeSessions: 0,
    idleSessions: 1,
    suspendedSessions: 0,
    maxConcurrency: 5,
    sessions: [{ issueKey: "ANC-37", state: "idle" }],
  },
  {
    role: "ops",
    name: "Ops",
    hasCapacity: true,
    activeSessions: 1,
    idleSessions: 0,
    suspendedSessions: 0,
    maxConcurrency: 5,
    sessions: [{ issueKey: "ANC-39", state: "active", uptime: 3412 }],
  },
];

export const mockAgentDetails: Record<string, AgentStatusDetail> = {
  engineer: {
    ...mockAgents[0],
    model: "claude-code",
    linearUserId: "agent-engineer",
    personaFiles: ["base.md", "engineer.md", "code-review.md"],
    dutySlots: 1,
    memoryCount: 12,
  },
  strategist: {
    ...mockAgents[1],
    model: "claude-code",
    linearUserId: "agent-strategist",
    personaFiles: ["base.md", "strategist.md"],
    dutySlots: 1,
    memoryCount: 8,
  },
  ops: {
    ...mockAgents[2],
    model: "claude-code",
    linearUserId: "agent-ops",
    personaFiles: ["base.md", "ops.md", "incident-response.md"],
    dutySlots: 1,
    memoryCount: 5,
  },
};

// --- Agent output (GET /agents/:role/output) ---

export const mockAgentOutputs: Record<string, AgentOutput[]> = {
  engineer: [
    {
      issueKey: "ANC-42",
      tmuxSession: "anc-engineer-ANC-42",
      output: [
        "$ claude --resume",
        "",
        "Resuming session for ANC-42...",
        "> Analyzing src/bus.ts for WebSocket integration points",
        "> Found EventEmitter base class, extending with WS broadcast",
        "> Writing src/ws/server.ts",
        "",
        "Running vitest...",
        "  PASS  tests/ws/server.test.ts (3 tests)",
        "  PASS  tests/bus.test.ts (7 tests)",
        "",
        "All tests passing. Committing changes.",
      ].join("\n"),
    },
  ],
  strategist: [],
  ops: [
    {
      issueKey: "ANC-39",
      tmuxSession: "anc-ops-ANC-39",
      output: [
        "$ anc status",
        "",
        "System Health: OK",
        "Active agents: 2/3",
        "Queue: 1 pending, 2 running",
        "",
        "> Monitoring Linear webhook delivery...",
        "> Webhook latency: 120ms avg",
        "All systems nominal.",
      ].join("\n"),
    },
  ],
};

// --- Agent memory (GET /agents/:role/memory) ---

export const mockAgentMemory: Record<string, string[]> = {
  engineer: ["architecture.md", "decisions.md", "patterns.md"],
  strategist: ["strategy.md", "research-notes.md"],
  ops: ["runbook.md"],
};

// --- Tasks ---

export const mockTasks: TaskRow[] = [
  {
    id: "ANC-42",
    role: "engineer",
    issueKey: "ANC-42",
    state: "active",
    priority: 2,
    spawnedAt: minutes(120),
    isDuty: false,
    ceoAssigned: false,
  },
  {
    id: "ANC-39",
    role: "ops",
    issueKey: "ANC-39",
    state: "active",
    priority: 3,
    spawnedAt: minutes(57),
    isDuty: false,
    ceoAssigned: false,
  },
  {
    id: "ANC-38",
    role: "engineer",
    issueKey: "ANC-38",
    state: "idle",
    priority: 3,
    spawnedAt: hours(8),
    isDuty: false,
    ceoAssigned: false,
  },
  {
    id: "ANC-37",
    role: "strategist",
    issueKey: "ANC-37",
    state: "idle",
    priority: 3,
    spawnedAt: hours(12),
    isDuty: false,
    ceoAssigned: false,
  },
  {
    id: "ANC-43",
    role: "engineer",
    issueKey: "ANC-43",
    state: "suspended",
    priority: 1,
    spawnedAt: hours(2),
    isDuty: false,
    ceoAssigned: true,
  },
];

export const mockTaskDetail: TaskDetail = {
  role: "engineer",
  issueKey: "ANC-42",
  tmuxSession: "anc-engineer-ANC-42",
  state: "active",
  spawnedAt: minutes(120),
  priority: 2,
  ceoAssigned: false,
  handoffProcessed: false,
  useContinue: false,
  isDuty: false,
  alive: true,
};

// --- Queue ---

export const mockQueueItems: QueueItem[] = [
  {
    id: "q-1",
    issueKey: "ANC-44",
    issueId: "issue-44",
    agentRole: "engineer",
    priority: 3,
    context: "Add per-agent cost tracking",
    createdAt: isoDatetime(minutes(30)),
    status: "queued",
  },
  {
    id: "q-2",
    issueKey: "ANC-45",
    issueId: "issue-45",
    agentRole: "strategist",
    priority: 5,
    context: "Research multi-model routing",
    createdAt: isoDatetime(minutes(45)),
    status: "queued",
  },
];

// --- Events ---

export const mockEvents: EventRow[] = [
  {
    id: 1,
    eventType: "agent:spawned",
    role: "engineer",
    issueKey: "ANC-42",
    detail: "Engineer started ANC-42",
    createdAt: sqliteDatetime(minutes(120)),
  },
  {
    id: 2,
    eventType: "agent:spawned",
    role: "ops",
    issueKey: "ANC-39",
    detail: "Ops started ANC-39",
    createdAt: sqliteDatetime(minutes(57)),
  },
  {
    id: 3,
    eventType: "webhook:issue.created",
    issueKey: "ANC-43",
    detail: "Issue ANC-43 created",
    createdAt: sqliteDatetime(minutes(30)),
  },
  {
    id: 4,
    eventType: "queue:enqueued",
    role: "engineer",
    issueKey: "ANC-44",
    detail: "Queued with priority 3",
    createdAt: sqliteDatetime(minutes(25)),
  },
  {
    id: 5,
    eventType: "agent:idle",
    role: "strategist",
    issueKey: "ANC-37",
    detail: "Strategist idle",
    createdAt: sqliteDatetime(hours(12)),
  },
  {
    id: 6,
    eventType: "agent:completed",
    role: "engineer",
    issueKey: "ANC-38",
    detail: "Engineer completed ANC-38",
    createdAt: sqliteDatetime(hours(8)),
  },
];

// --- WebSocket snapshot ---

export const mockSnapshot: WsSnapshot = {
  agents: mockAgents,
  sessions: mockTasks.map((t) => ({
    role: t.role,
    issueKey: t.issueKey,
    state: t.state,
    spawnedAt: t.spawnedAt,
    priority: t.priority,
  })),
  queue: mockQueueItems,
  uptime: 170_580,
};

// --- KPI helpers ---

export function deriveKpis(agents: AgentStatus[], queueItems: QueueItem[]) {
  const running = agents.reduce((sum, a) => sum + a.activeSessions, 0);
  const idle = agents.reduce((sum, a) => sum + a.idleSessions, 0);
  const queued = queueItems.filter((q) => q.status === "queued").length;
  return { running, idle, queued, agentCount: agents.length };
}
