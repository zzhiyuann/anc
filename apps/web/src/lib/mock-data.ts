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
  TaskDetail,
  QueueItem,
  EventRow,
  AgentOutput,
  WsSnapshot,
  SessionState,
  Task,
  TaskFull,
  TaskComment,
  TaskEvent,
  TaskAttachment,
  Project,
  ProjectWithStats,
  AncNotification,
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

export const mockTasks: Task[] = [
  {
    id: "task-anc-42",
    projectId: null,
    title: "Fix auth middleware token refresh",
    description: "Login times out after 30s on mobile",
    state: "running",
    priority: 2,
    source: "dashboard",
    parentTaskId: null,
    createdBy: "ceo",
    linearIssueKey: "ANC-42",
    createdAt: minutes(120),
    completedAt: null,
    handoffSummary: null,
  },
  {
    id: "task-anc-39",
    projectId: null,
    title: "Investigate queue backlog spike",
    description: null,
    state: "running",
    priority: 3,
    source: "dashboard",
    parentTaskId: null,
    createdBy: "ceo",
    linearIssueKey: "ANC-39",
    createdAt: minutes(57),
    completedAt: null,
    handoffSummary: null,
  },
  {
    id: "task-anc-38",
    projectId: null,
    title: "Refactor persona loader",
    description: null,
    state: "todo",
    priority: 3,
    source: "dashboard",
    parentTaskId: null,
    createdBy: "ceo",
    linearIssueKey: "ANC-38",
    createdAt: hours(8),
    completedAt: null,
    handoffSummary: null,
  },
  {
    id: "task-anc-37",
    projectId: null,
    title: "Research: multi-model routing",
    description: null,
    state: "review",
    priority: 3,
    source: "dashboard",
    parentTaskId: null,
    createdBy: "ceo",
    linearIssueKey: "ANC-37",
    createdAt: hours(12),
    completedAt: null,
    handoffSummary: null,
  },
  {
    id: "task-anc-43",
    projectId: null,
    title: "Production incident: dispatch queue stuck",
    description: null,
    state: "failed",
    priority: 1,
    source: "dashboard",
    parentTaskId: null,
    createdBy: "ceo",
    linearIssueKey: "ANC-43",
    createdAt: hours(2),
    completedAt: null,
    handoffSummary: null,
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
    role: "engineer",
    issueKey: t.linearIssueKey ?? t.id,
    state: (t.state === "running" ? "active" : t.state === "todo" ? "idle" : "suspended") as SessionState,
    spawnedAt: t.createdAt,
    priority: t.priority,
  })),
  queue: mockQueueItems,
  uptime: 170_580,
};

// ============================================================================
// Wave 2C: Mocks for the new task-entity / project / notification shapes
// ----------------------------------------------------------------------------
// These power the dashboard's offline-friendly fallback when the Wave 2A
// backend endpoints aren't available yet (api.ts withMockFallback helper).
// ============================================================================

// --- Project ---

export const mockProject: Project = {
  id: "proj-anc-core",
  name: "ANC Core",
  description: "Linear-native agent orchestration platform",
  color: "#7c3aed",
  icon: "rocket",
  state: "active",
  createdBy: "ceo",
  createdAt: hours(72),
  archivedAt: null,
};

export const mockProjectsWithStats: ProjectWithStats[] = [
  {
    ...mockProject,
    stats: { total: 14, running: 2, queued: 1, done: 9, totalCostUsd: 4.27 },
  },
  {
    id: "proj-marketing-q2",
    name: "Marketing Q2",
    description: "Launch campaign content + research",
    color: "#0ea5e9",
    icon: "megaphone",
    state: "active",
    createdBy: "ceo",
    createdAt: hours(120),
    archivedAt: null,
    stats: { total: 6, running: 0, queued: 2, done: 3, totalCostUsd: 1.10 },
  },
  {
    id: "proj-system",
    name: "System",
    description: "Built-in project for duty sessions and ops",
    color: "#64748b",
    icon: "settings",
    state: "active",
    createdBy: "system",
    createdAt: hours(240),
    archivedAt: null,
    stats: { total: 4, running: 1, queued: 0, done: 3, totalCostUsd: 0.42 },
  },
];

// --- First-class Task entity ---

export const mockTask: Task = {
  id: "task-abc",
  projectId: "proj-anc-core",
  title: "Fix auth bug in login flow",
  description:
    "Users with SSO accounts are bounced back to /login after callback. " +
    "Investigate the session cookie domain mismatch.",
  state: "running",
  priority: 2,
  source: "dashboard",
  parentTaskId: null,
  createdBy: "ceo",
  linearIssueKey: null,
  createdAt: hours(3),
  completedAt: null,
  handoffSummary: null,
};

// --- Task events / comments / attachments / cost / handoff ---

export const mockTaskEvents: TaskEvent[] = [
  {
    id: 1,
    taskId: "task-abc",
    role: "engineer",
    type: "agent:spawned",
    payload: { tmuxSession: "anc-engineer-task-abc" },
    createdAt: hours(3),
  },
  {
    id: 2,
    taskId: "task-abc",
    role: "engineer",
    type: "agent:plan-announced",
    payload: { plan: "1) Reproduce 2) Inspect cookies 3) Fix domain 4) Test" },
    createdAt: hours(3) + 60_000,
  },
  {
    id: 3,
    taskId: "task-abc",
    role: "engineer",
    type: "agent:tool-call-start",
    payload: { tool: "Bash", input: "grep -r 'cookie.domain' src/" },
    createdAt: hours(2),
  },
  {
    id: 4,
    taskId: "task-abc",
    role: "engineer",
    type: "agent:file-edit",
    payload: { file: "src/auth/session.ts", lines: 12 },
    createdAt: minutes(45),
  },
];

export const mockTaskComments: TaskComment[] = [
  {
    id: 1,
    taskId: "task-abc",
    author: "ceo",
    body: "Look at the login callback path first — I think the cookie domain is wrong.",
    parentId: null,
    createdAt: hours(3) - 30_000,
  },
  {
    id: 2,
    taskId: "task-abc",
    author: "agent:engineer",
    body: "Found it — `Domain=.example.com` was missing the leading dot. Fixing now.",
    parentId: 1,
    createdAt: minutes(40),
  },
];

export const mockTaskAttachments: TaskAttachment[] = [
  { name: "HANDOFF.md", size: 1240, mtime: minutes(20), kind: "handoff" },
  { name: "code/src/auth/session.ts", size: 3456, mtime: minutes(40), kind: "code" },
  { name: "memory/decisions.md", size: 820, mtime: hours(2), kind: "memory" },
];

export const mockTaskFull: TaskFull = {
  task: mockTask,
  sessions: [
    {
      issueKey: "task-abc",
      role: "engineer",
      state: "active",
      tmuxSession: "anc-engineer-task-abc",
      spawnedAt: hours(3),
      alive: true,
    },
    {
      issueKey: "task-abc",
      role: "strategist",
      state: "idle",
      tmuxSession: null,
      spawnedAt: hours(2),
      alive: false,
    },
  ],
  events: mockTaskEvents,
  comments: mockTaskComments,
  attachments: mockTaskAttachments,
  cost: {
    totalUsd: 1.24,
    byAgent: [
      { role: "engineer", usd: 0.87, tokens: 142_000 },
      { role: "strategist", usd: 0.37, tokens: 58_000 },
    ],
  },
  children: [
    {
      ...mockTask,
      id: "task-xyz",
      title: "Write auth regression tests",
      state: "review",
      parentTaskId: "task-abc",
      createdAt: hours(1),
    },
  ],
  handoff: {
    body: "## Summary\nFixed cookie domain.\n\n## Actions\nstatus: In Review",
    actions: { status: "In Review", dispatches: [] },
  },
};

// --- Notifications ---

export const mockNotifications: AncNotification[] = [
  {
    id: 1,
    kind: "completion",
    severity: "info",
    title: "engineer completed task-abc",
    body: "Auth bug fix ready for review",
    taskId: "task-abc",
    projectId: "proj-anc-core",
    agentRole: "engineer",
    readAt: null,
    archivedAt: null,
    createdAt: minutes(15),
  },
  {
    id: 2,
    kind: "mention",
    severity: "info",
    title: "engineer mentioned you on task-abc",
    body: "@ceo can you confirm the staging URL?",
    taskId: "task-abc",
    projectId: "proj-anc-core",
    agentRole: "engineer",
    readAt: null,
    archivedAt: null,
    createdAt: minutes(35),
  },
  {
    id: 3,
    kind: "budget",
    severity: "warning",
    title: "Daily budget at 78%",
    body: "$3.90 / $5.00 spent today",
    taskId: null,
    projectId: null,
    agentRole: null,
    readAt: null,
    archivedAt: null,
    createdAt: hours(1),
  },
  {
    id: 4,
    kind: "briefing",
    severity: "info",
    title: "Daily briefing from ceo-office",
    body: "3 tasks completed, 2 in progress, 1 queued",
    taskId: null,
    projectId: null,
    agentRole: "ceo-office",
    readAt: hours(4),
    archivedAt: null,
    createdAt: hours(6),
  },
];

// --- KPI helpers ---

export function deriveKpis(agents: AgentStatus[], queueItems: QueueItem[]) {
  const running = agents.reduce((sum, a) => sum + a.activeSessions, 0);
  const idle = agents.reduce((sum, a) => sum + a.idleSessions, 0);
  const queued = queueItems.filter((q) => q.status === "queued").length;
  return { running, idle, queued, agentCount: agents.length };
}
