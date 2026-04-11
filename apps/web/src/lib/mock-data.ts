import type {
  Agent,
  AgentDetail,
  Task,
  AncEvent,
  QueueState,
  SystemHealth,
  MemoryEntry,
  SessionEntry,
} from "./types";

// --- Agents ---

export const mockAgents: Agent[] = [
  {
    role: "engineer",
    name: "Engineer",
    status: "active",
    model: "claude-sonnet-4-20250514",
    currentTask: "Implement WebSocket event bus",
    currentIssueKey: "ANC-42",
    uptime: 7234,
    memoryFiles: 12,
    sessionCount: 47,
    avatar: "E",
  },
  {
    role: "strategist",
    name: "Strategist",
    status: "idle",
    model: "claude-sonnet-4-20250514",
    currentTask: null,
    currentIssueKey: null,
    uptime: 0,
    memoryFiles: 8,
    sessionCount: 23,
    avatar: "S",
  },
  {
    role: "ops",
    name: "Ops",
    status: "active",
    model: "claude-sonnet-4-20250514",
    currentTask: "Monitor deployment pipeline",
    currentIssueKey: "ANC-39",
    uptime: 3412,
    memoryFiles: 5,
    sessionCount: 31,
    avatar: "O",
  },
];

export const mockAgentDetails: Record<string, AgentDetail> = {
  engineer: {
    ...mockAgents[0],
    description:
      "Handles code, architecture, testing, and code review. Primary executor for all engineering tasks.",
    outputLines: [
      "$ claude --model claude-sonnet-4-20250514 --resume",
      "",
      "Resuming session for ANC-42...",
      "Reading workspace at ~/workspaces/ANC-42/",
      "",
      "> Analyzing src/bus.ts for WebSocket integration points...",
      "> Found EventEmitter base class, extending with WS broadcast",
      "> Creating src/ws/server.ts with upgrade handler",
      "",
      "Writing src/ws/server.ts...",
      '  import { WebSocketServer } from "ws";',
      '  import { bus } from "../bus";',
      "",
      "  export function createWsServer(server: HttpServer) {",
      '    const wss = new WebSocketServer({ server, path: "/ws" });',
      "    bus.onAny((event, data) => {",
      "      wss.clients.forEach(client => {",
      '        if (client.readyState === WebSocket.OPEN) {',
      "          client.send(JSON.stringify({ type: event, data }));",
      "        }",
      "      });",
      "    });",
      "  }",
      "",
      "> Running vitest...",
      "  PASS  tests/ws/server.test.ts (3 tests)",
      "  PASS  tests/bus.test.ts (7 tests)",
      "",
      "All tests passing. Committing changes.",
      '$ git commit -m "feat: add WebSocket broadcast to event bus"',
    ],
    memoryEntries: [
      {
        filename: "architecture.md",
        content:
          "# ANC Architecture\n\nEvent-driven system with typed bus...",
        updatedAt: "2026-04-11T08:30:00Z",
        sizeBytes: 2048,
      },
      {
        filename: "decisions.md",
        content:
          "# Engineering Decisions\n\n## 2026-04-10: WebSocket over SSE\nChose WebSocket for bidirectional communication...",
        updatedAt: "2026-04-10T16:45:00Z",
        sizeBytes: 1536,
      },
      {
        filename: "patterns.md",
        content:
          "# Code Patterns\n\n## Event Handler Pattern\nAll handlers follow the typed EventHandler<T> interface...",
        updatedAt: "2026-04-09T14:20:00Z",
        sizeBytes: 892,
      },
    ],
    sessions: [
      {
        id: "sess-001",
        issueKey: "ANC-42",
        startedAt: "2026-04-11T06:00:00Z",
        endedAt: null,
        status: "running",
        duration: 7234,
      },
      {
        id: "sess-002",
        issueKey: "ANC-38",
        startedAt: "2026-04-10T14:00:00Z",
        endedAt: "2026-04-10T16:30:00Z",
        status: "completed",
        duration: 9000,
      },
      {
        id: "sess-003",
        issueKey: "ANC-35",
        startedAt: "2026-04-09T09:00:00Z",
        endedAt: "2026-04-09T11:45:00Z",
        status: "completed",
        duration: 9900,
      },
      {
        id: "sess-004",
        issueKey: "ANC-33",
        startedAt: "2026-04-08T13:00:00Z",
        endedAt: "2026-04-08T13:22:00Z",
        status: "failed",
        duration: 1320,
      },
    ],
  },
  strategist: {
    ...mockAgents[1],
    description:
      "Handles product strategy, research, content creation, and high-level planning.",
    outputLines: [
      "Last session ended at 2026-04-10T18:00:00Z",
      "",
      "Completed: Product roadmap analysis for Q2",
      "Output saved to ~/workspaces/ANC-37/roadmap-q2.md",
      "",
      "Awaiting next assignment...",
    ],
    memoryEntries: [
      {
        filename: "strategy.md",
        content:
          "# Product Strategy\n\nFocus areas for Q2:\n1. Agent autonomy improvements\n2. Multi-model support...",
        updatedAt: "2026-04-10T18:00:00Z",
        sizeBytes: 3200,
      },
      {
        filename: "research-notes.md",
        content:
          "# Research Notes\n\n## Agent Orchestration Landscape\n- CrewAI: multi-agent framework...",
        updatedAt: "2026-04-09T12:00:00Z",
        sizeBytes: 4100,
      },
    ],
    sessions: [
      {
        id: "sess-005",
        issueKey: "ANC-37",
        startedAt: "2026-04-10T14:00:00Z",
        endedAt: "2026-04-10T18:00:00Z",
        status: "completed",
        duration: 14400,
      },
      {
        id: "sess-006",
        issueKey: "ANC-34",
        startedAt: "2026-04-09T09:00:00Z",
        endedAt: "2026-04-09T12:30:00Z",
        status: "completed",
        duration: 12600,
      },
    ],
  },
  ops: {
    ...mockAgents[2],
    description:
      "Handles monitoring, triage, alerting, deployments, and operational tasks.",
    outputLines: [
      "$ anc status",
      "",
      "System Health: OK",
      "Active agents: 2/3",
      "Queue: 1 pending, 2 running",
      "Uptime: 47h 23m",
      "",
      "> Checking deployment pipeline...",
      "> GitHub Actions: all green",
      "> Last deploy: 2026-04-11T04:00:00Z (7h ago)",
      "> No alerts in PagerDuty",
      "",
      "> Monitoring Linear webhook delivery...",
      "> Last event: issue.updated at 11:02:14",
      "> Webhook latency: 120ms avg (last 1h)",
      "",
      "All systems nominal.",
    ],
    memoryEntries: [
      {
        filename: "runbook.md",
        content:
          "# Ops Runbook\n\n## Incident Response\n1. Check system health endpoint...",
        updatedAt: "2026-04-11T09:00:00Z",
        sizeBytes: 1800,
      },
    ],
    sessions: [
      {
        id: "sess-007",
        issueKey: "ANC-39",
        startedAt: "2026-04-11T07:05:00Z",
        endedAt: null,
        status: "running",
        duration: 3412,
      },
      {
        id: "sess-008",
        issueKey: "ANC-36",
        startedAt: "2026-04-10T08:00:00Z",
        endedAt: "2026-04-10T10:15:00Z",
        status: "completed",
        duration: 8100,
      },
    ],
  },
};

// --- Tasks ---

export const mockTasks: Task[] = [
  {
    id: "task-1",
    issueKey: "ANC-42",
    title: "Implement WebSocket event bus",
    description: "Add WS broadcast to the typed event bus for real-time dashboard updates",
    status: "in_progress",
    priority: "high",
    agent: "engineer",
    duration: 7234,
    createdAt: "2026-04-10T10:00:00Z",
    updatedAt: "2026-04-11T06:00:00Z",
  },
  {
    id: "task-2",
    issueKey: "ANC-39",
    title: "Monitor deployment pipeline",
    description: "Continuous monitoring of CI/CD and deployment health",
    status: "in_progress",
    priority: "medium",
    agent: "ops",
    duration: 3412,
    createdAt: "2026-04-10T14:00:00Z",
    updatedAt: "2026-04-11T07:05:00Z",
  },
  {
    id: "task-3",
    issueKey: "ANC-43",
    title: "Build CEO dashboard web app",
    description: "Create Next.js dashboard for monitoring and controlling agents",
    status: "in_progress",
    priority: "high",
    agent: "engineer",
    duration: null,
    createdAt: "2026-04-11T09:00:00Z",
    updatedAt: "2026-04-11T09:00:00Z",
  },
  {
    id: "task-4",
    issueKey: "ANC-44",
    title: "Add per-agent cost tracking",
    description: "Track API token usage and cost per agent per session",
    status: "todo",
    priority: "medium",
    agent: null,
    duration: null,
    createdAt: "2026-04-11T08:00:00Z",
    updatedAt: "2026-04-11T08:00:00Z",
  },
  {
    id: "task-5",
    issueKey: "ANC-45",
    title: "Research multi-model routing",
    description: "Investigate routing tasks to different LLM providers based on task type",
    status: "backlog",
    priority: "low",
    agent: null,
    duration: null,
    createdAt: "2026-04-10T12:00:00Z",
    updatedAt: "2026-04-10T12:00:00Z",
  },
  {
    id: "task-6",
    issueKey: "ANC-38",
    title: "Refactor event handler registration",
    description: "Clean up handler registration to use declarative YAML config",
    status: "in_review",
    priority: "medium",
    agent: "engineer",
    duration: 9000,
    createdAt: "2026-04-09T10:00:00Z",
    updatedAt: "2026-04-10T16:30:00Z",
  },
  {
    id: "task-7",
    issueKey: "ANC-37",
    title: "Q2 product roadmap analysis",
    description: "Analyze competitive landscape and define Q2 priorities",
    status: "done",
    priority: "high",
    agent: "strategist",
    duration: 14400,
    createdAt: "2026-04-09T08:00:00Z",
    updatedAt: "2026-04-10T18:00:00Z",
  },
  {
    id: "task-8",
    issueKey: "ANC-46",
    title: "Set up Discord notification channel",
    description: "Configure Discord webhook for agent status notifications",
    status: "todo",
    priority: "low",
    agent: null,
    duration: null,
    createdAt: "2026-04-11T07:00:00Z",
    updatedAt: "2026-04-11T07:00:00Z",
  },
  {
    id: "task-9",
    issueKey: "ANC-47",
    title: "Implement agent memory pruning",
    description: "Auto-prune memory files older than 30 days to prevent bloat",
    status: "backlog",
    priority: "medium",
    agent: null,
    duration: null,
    createdAt: "2026-04-11T06:00:00Z",
    updatedAt: "2026-04-11T06:00:00Z",
  },
  {
    id: "task-10",
    issueKey: "ANC-36",
    title: "Audit tmux session cleanup",
    description: "Verify orphaned tmux sessions are properly cleaned up on agent stop",
    status: "done",
    priority: "medium",
    agent: "ops",
    duration: 8100,
    createdAt: "2026-04-08T14:00:00Z",
    updatedAt: "2026-04-10T10:15:00Z",
  },
];

// --- Events ---

export const mockEvents: AncEvent[] = [
  {
    id: "evt-1",
    type: "agent.started",
    agent: "engineer",
    message: "Engineer started working on ANC-42",
    timestamp: "2026-04-11T06:00:00Z",
  },
  {
    id: "evt-2",
    type: "agent.started",
    agent: "ops",
    message: "Ops started monitoring deployment pipeline",
    timestamp: "2026-04-11T07:05:00Z",
  },
  {
    id: "evt-3",
    type: "task.created",
    agent: null,
    message: "New task created: Build CEO dashboard web app (ANC-43)",
    timestamp: "2026-04-11T09:00:00Z",
  },
  {
    id: "evt-4",
    type: "system.health",
    agent: null,
    message: "System health check passed — all services operational",
    timestamp: "2026-04-11T09:15:00Z",
  },
  {
    id: "evt-5",
    type: "agent.completed",
    agent: "strategist",
    message: "Strategist completed Q2 roadmap analysis (ANC-37)",
    timestamp: "2026-04-10T18:00:00Z",
  },
  {
    id: "evt-6",
    type: "task.assigned",
    agent: "engineer",
    message: "ANC-42 assigned to Engineer",
    timestamp: "2026-04-10T10:05:00Z",
  },
  {
    id: "evt-7",
    type: "agent.completed",
    agent: "engineer",
    message: "Engineer completed event handler refactor (ANC-38)",
    timestamp: "2026-04-10T16:30:00Z",
  },
  {
    id: "evt-8",
    type: "message.sent",
    agent: "engineer",
    message: 'CEO sent message to Engineer: "Prioritize WS integration"',
    timestamp: "2026-04-10T10:02:00Z",
  },
  {
    id: "evt-9",
    type: "agent.idle",
    agent: "strategist",
    message: "Strategist is now idle",
    timestamp: "2026-04-10T18:01:00Z",
  },
  {
    id: "evt-10",
    type: "task.completed",
    agent: "ops",
    message: "Ops completed tmux session audit (ANC-36)",
    timestamp: "2026-04-10T10:15:00Z",
  },
];

// --- Queue ---

export const mockQueueState: QueueState = {
  pending: 1,
  running: 2,
  completed: 5,
  failed: 0,
  items: [
    {
      id: "q-1",
      issueKey: "ANC-42",
      agent: "engineer",
      priority: "high",
      status: "running",
      enqueuedAt: "2026-04-11T05:58:00Z",
    },
    {
      id: "q-2",
      issueKey: "ANC-39",
      agent: "ops",
      priority: "medium",
      status: "running",
      enqueuedAt: "2026-04-11T07:00:00Z",
    },
    {
      id: "q-3",
      issueKey: "ANC-44",
      agent: "engineer",
      priority: "medium",
      status: "pending",
      enqueuedAt: "2026-04-11T08:00:00Z",
    },
  ],
};

// --- Health ---

export const mockHealth: SystemHealth = {
  status: "healthy",
  uptime: 170580,
  agents: {
    total: 3,
    active: 2,
    idle: 1,
    failed: 0,
  },
  queue: {
    pending: 1,
    running: 2,
  },
  memory: {
    heapUsed: 89_000_000,
    heapTotal: 256_000_000,
  },
  version: "0.1.0",
};

// --- KPI helpers ---

export function getKpis() {
  const running = mockAgents.filter((a) => a.status === "active").length;
  const idle = mockAgents.filter((a) => a.status === "idle").length;
  const queued = mockTasks.filter((t) => t.status === "todo").length;
  const todayCost = 4.82; // mock daily cost in USD

  return { running, idle, queued, todayCost };
}
