# ANC — System Architecture

## Component Interaction Specifications

---

## 1. System Overview

```
┌─────────────────────────────────────────────────────────────���───┐
│                        ANC System                                │
│                                                                  │
│  ┌───────────────────────────────────────────────────────────┐   │
│  │                    Gateway (:3848)                         │   │
│  │  HTTP: /webhook  /api/v1/*  /                             │   │
│  │  WS:   /ws                                                │   │
│  └────┬──────────────────────┬───────────────────────────┬───┘   │
│       │                      │                           │       │
│       ▼                      ▼                           ▼       │
│  ┌─────────┐          ┌────────────┐              ┌──────────┐  │
│  │ Webhook │          │  API Router│              │WebSocket │  │
│  │ Handler │          │  (REST)    │              │ Server   │  │
│  └────┬────┘          └─────┬──────┘              └────┬─────┘  │
│       │                     │                          │        │
│       ▼                     ▼                          ▲        │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                     Event Bus                             │   │
│  │  emit() → middleware pipeline → handler dispatch           │   │
│  │  Middlewares: [wsRelay] [eventLog] [metrics]              │   │
│  └──────────────────────────┬───────────────────────────────┘   │
│                             │                                    │
│       ┌──────────┬──────────┼─────────��┬──────────┐             │
│       ▼          ▼          ▼          ▼          ▼             │
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐       │
│  │on-issue│ │on-comment│ │on-tick │ │on-duty │ │on-compl│       │
│  │        │ │        │ │(30s)   │ │(cron)  │ │ete     │       │
│  └───┬────┘ └───┬────┘ └───┬────┘ └───┬────┘ └───┬────┘       │
│      │          │          │          │          │              │
│      └──────────┴──────────┼──────────┴──────────┘              │
│                            ▼                                     │
│                    ┌───────────────┐                              │
│                    │  Resolve Gate │ ← Single convergence point  │
│                    │               │                              │
│                    │ 1. Breaker?   │                              │
│                    │ 2. Active?    │                              │
│                    │ 3. Idle?      │                              │
│                    │ 4. Suspended? │                              │
│                    │ 5. Capacity?  │                              │
│                    │ 6. Queue?     │                              │
│                    └───────┬───────┘                              │
│                            │                                     │
│              ┌─────────────┼─────────────┐                       │
│              ▼             ▼             ▼                        │
│         ┌────────┐   ┌────────┐    ┌────────┐                   │
│         │ Spawn  │   │ Resume │    │ Queue  │                   │
│         │ (new)  │   │(cont.) │    │(wait)  │                   │
│         └───┬────┘   └───┬────┘    └────────┘                   │
│             │            │                                       │
│             ▼            ▼                                        │
│        ┌──────────────────────┐                                  │
│        │   Runtime Manager    │                                  │
│        │                      │                                  │
│        │  ┌────────────────┐  │                                  │
│        │  │ Health Tracker │  │   ┌─────────────────────┐        │
│        │  │ (session map)  │  │   │  Budget Tracker     │        │
│        │  └────────────────┘  │   │  (spend check)      │        │
│        │                      │   └─────────────────────┘        │
│        │  ┌────────────────┐  │                                  │
│        │  │ Runner (tmux)  │  │   ┌─────────────────────┐        │
│        │  │ spawn/kill/    │  │   │  Circuit Breaker    │        │
│        │  │ resume/output  │  │   │  (per-issue)        │        │
│        │  └────────────────┘  │   └─────────────────────┘        │
│        │                      │                                  │
│        │  ┌────────────────┐  │                                  │
│        │  │ Workspace Mgr  │  │                                  │
│        │  │ (per-issue)    │  │                                  │
│        │  └────────────────┘  │                                  │
│        └──────────────────────┘                                  │
│                                                                  │
│  ┌───────────────────────────────────────────────────────────┐   │
│  │                   Agent System                             │   │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌─────────────┐  │   │
│  │  │ Registry │ │ Persona  │ │ Memory   │ │ SDK (CLI)   │  │   │
│  │  │ (YAML)   │ │ Composer │ │ Manager  │ │ for agents  │  │   │
│  │  └──────────┘ └──────────┘ └──────────┘ └─────────────┘  │   │
│  └───────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌───────────────────────────────────────────────────────────┐   │
│  │                     Storage                                │   │
│  │  ┌─────────────┐  ┌─────────────────┐  ┌──────────────┐  │   │
│  │  │ SQLite      │  │ Filesystem      │  │ Config       │  │   │
│  │  │ state.db    │  │ ~/.anc/memory/  │  │ config/*.yaml│  │   │
│  │  │ (tasks,     │  │ (agent memory,  │  │ (agents,     │  │   │
│  │  │  events,    │  │  shared memory, │  │  routing,    │  │   │
│  │  │  queue,     │  │  retrospectives)│  │  duties,     │  │   │
│  │  │  budget)    │  │                 │  │  budget)     │  │   │
│  │  └─────────────┘  └─────────────────┘  └──────────────┘  │   │
│  └───────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌───────────────────────────────────────────────────────────┐   │
│  │                  Integration Adapters                      │   │
│  │  ┌────────┐  ┌─────────┐  ┌──────────┐  ┌─────────┐     │   │
│  │  │ Linear │  │ Discord │  │ Telegram │  │ GitHub  │     │   │
│  │  │ Sync   │  │ Bridge  │  │ Notify   │  │ (v0.3)  │     │   │
│  │  └────────┘  └─────────┘  └──────────┘  └─────────┘     │   │
│  └───────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. Component Responsibilities

### 2.1 Gateway

**Single entry point. Zero business logic.**

| Responsibility | NOT Responsible For |
|---------------|-------------------|
| HTTP/WS listener | Routing decisions |
| Webhook signature verification | Agent spawning |
| Request parsing + validation | State management |
| CORS headers | Business rules |
| Static file serving (Dashboard) | Integration logic |
| WebSocket upgrade handling | |

**Port:** 3848 (configurable)

The gateway receives requests and translates them into bus events. It never calls agent or runtime functions directly.

### 2.2 Event Bus

**Nervous system. All component communication goes through here.**

| Responsibility | NOT Responsible For |
|---------------|-------------------|
| Event routing to subscribers | Event generation |
| Concurrent handler execution | Error recovery |
| Middleware pipeline | State persistence |
| Error isolation (allSettled) | Business logic |

**Middleware chain** (executed in order for every event):
1. `wsRelay` — broadcasts event to Dashboard clients
2. `eventLog` — persists event to SQLite events table
3. `metrics` — updates internal counters (optional)

### 2.3 Hooks (Event Handlers)

Each hook file registers handlers for specific bus events.

| Hook | Listens To | Does |
|------|-----------|------|
| `on-issue` | `webhook:issue.created` | Route issue → resolve |
| `on-comment` | `webhook:comment.created` | Route to active agent or create task |
| `on-tick` | `system:tick` (30s) | Check active sessions, drain queue, cleanup |
| `on-complete` | `agent:idle`, `agent:completed` | Parse HANDOFF, execute actions, retro |
| `on-duties` | `system:tick`, specific events | Trigger standing duties per YAML |
| `on-lifecycle` | `agent:*` | Status comments, integration sync |
| `on-bridge` | Discord/Linear bridge events | Cross-platform message relay |
| `on-ceo-office` | `agent:failed`, `system:budget-alert`, `agent:stuck` | CEO Office Agent recovery logic |

### 2.4 Resolve Gate

**THE single point where session decisions are made.**

```
Input: (issueKey, agentRole, message?, priority?)
Output: one of:
  - SPAWNED (new tmux session created)
  - PIPED (message sent to existing session)
  - RESUMED (idle session reactivated with --continue)
  - RESTORED (suspended session resumed with checkpoint)
  - QUEUED (no capacity, added to queue)
  - REJECTED (circuit breaker tripped)
  - BUDGET_EXCEEDED (budget limit reached)
```

**No other component may spawn, resume, or pipe to agents.** All paths converge here.

### 2.5 Runtime Manager

**Owns all tmux session state.**

Sub-components:

| Component | Owns |
|-----------|------|
| Health Tracker | In-memory session map: `Map<issueKey, SessionState>` |
| Runner | tmux process management: spawn, kill, pipe, capture output |
| Workspace Manager | Per-issue directory creation, persona injection, git worktree |
| Circuit Breaker | Per-issue failure counting + backoff |

**Health Tracker session states:**
```typescript
interface SessionState {
  issueKey: string
  agentRole: string
  status: 'active' | 'idle' | 'suspended'
  tmuxSession: string | null     // null when idle/suspended
  spawnedAt: number
  lastActivity: number
  linearSessionId?: string       // for integration sync
  cost: { tokens: number; usd: number }
}
```

### 2.6 Agent System

| Component | Owns |
|-----------|------|
| Registry | Agent definitions from YAML. Role → config mapping. |
| Persona Composer | Assembles CLAUDE.md from fragments + memory + retros |
| Memory Manager | Read/write/search memory files. Shared memory. Scoring. |
| SDK | CLI commands that agents can invoke from inside their session |

### 2.7 Storage

**Three storage systems, each for different data characteristics:**

| Storage | Data | Characteristics |
|---------|------|----------------|
| SQLite (`state.db`) | Tasks, events, queue, budget | Structured, queryable, disposable (can rebuild from integrations) |
| Filesystem (`~/.anc/memory/`) | Agent memory, shared knowledge, retros | Persistent, human-readable, git-trackable |
| Config YAML (`config/`) | Agents, routing, duties, budget | User-editable, version-controlled |

**SQLite is a cache, not the source of truth.** If `state.db` is deleted, active tmux sessions still run. The system recovers by scanning tmux.

**Filesystem memory is the source of truth for agent knowledge.** It survives any system failure.

---

## 3. Data Flow Specifications

### 3.1 Task Creation (Dashboard)

```
1. User clicks "New Task" in Dashboard
2. Dashboard POST /api/v1/tasks
   { title: "Fix auth bug", description: "...", agent: "engineer", priority: 2 }

3. API handler:
   a. Insert into SQLite tasks table (status: queued)
   b. bus.emit('webhook:issue.created', { issue, source: 'dashboard' })
   c. Return 201 { id, issueKey: 'ANC-73' }

4. Bus middleware:
   a. wsRelay → Dashboard gets task:created event
   b. eventLog → event stored in SQLite

5. on-issue handler:
   a. Route: match rules → agentRole = 'engineer'
   b. resolve(issueKey, agentRole, null, priority)

6. Resolve Gate:
   a. Circuit breaker check → OK
   b. Budget check → OK
   c. No active session → check capacity
   d. engineer has 3/5 slots used → capacity OK
   e. → SPAWN

7. Runner:
   a. Create workspace: ~/anc-workspaces/ANC-73/
   b. Inject persona (CLAUDE.md assembled from fragments)
   c. Launch tmux session: anc-engineer-ANC-73
   d. Execute: claude --permission-mode auto -p "..."

8. bus.emit('agent:spawned', { role: 'engineer', issueKey: 'ANC-73' })

9. on-lifecycle handler:
   a. Linear connected? → LinearSync.createIssue() (background)
   b. Update task status in SQLite → running

10. WebSocket: agent:status event → Dashboard updates in real-time
```

### 3.2 Task Completion

```
1. system:tick fires (every 30s)

2. on-tick handler:
   a. For each active session:
      - Check if tmux session still alive
      - Check for HANDOFF.md in workspace

3. HANDOFF.md detected for ANC-73

4. on-complete handler:
   a. Parse HANDOFF.md:
      Summary: "Fixed the auth token refresh bug..."
      Actions:
        status: In Review
        dispatches:
          - role: strategist
            new_issue: "Write changelog entry"
            context: "Auth fix shipped, needs changelog"

   b. Execute actions:
      - Update task status → review
      - Create sub-task for strategist
      - resolve() for the new sub-task

   c. Process RETRO.md (if exists):
      - Append to shared memory
      - Cap at 10 entries per agent

   d. bus.emit('agent:completed', { role: 'engineer', issueKey: 'ANC-73', handoff })

5. on-lifecycle handler:
   a. Linear: update issue status + post completion comment
   b. Discord: post completion summary (if bridge active)

6. Health tracker: session → idle state
   tmuxSession = null, status = 'idle'

7. WebSocket: task:updated + agent:status events → Dashboard
```

### 3.3 CEO Office Agent Recovery

```
1. agent:failed event fires for Engineer on ANC-42

2. on-ceo-office handler:
   a. Check failure count for ANC-42
   b. count = 1 → transient, retry
      count = 2 → retry with warning
      count >= 3 → trip circuit breaker, escalate

3. Case: count = 1 (transient retry)
   a. resolve('ANC-42', 'engineer') → respawns
   b. Log to CEO Office memory

4. Case: count = 3 (escalate)
   a. Circuit breaker trips for ANC-42
   b. CEO Office spawns on duty issue:
      "Investigate repeated failure on ANC-42"
   c. CEO Office analyzes workspace, shared memory
   d. Writes briefing:
      { type: 'incident', title: 'ANC-42 failing repeatedly',
        content: 'Root cause: rate limit on external API...' }
   e. bus.emit('ceo:briefing')

5. Dashboard shows notification bell with briefing
6. Telegram notification sent to CEO
```

### 3.4 Agent-to-Agent Dispatch

```
1. Engineer working on ANC-42 writes HANDOFF.md:
   dispatches:
     - role: strategist
       new_issue: "Write docs for new auth flow"
       context: "Auth now uses JWT refresh tokens..."

2. on-complete parses dispatch:
   a. Create new task: ANC-73 "Write docs for new auth flow"
      parent: ANC-42, source: dispatch, priority: 3
   b. Insert into SQLite
   c. bus.emit('webhook:issue.created', { issue: ANC-73 })
   d. Linear: create sub-issue linked to parent

3. on-issue routes ANC-73 → strategist

4. resolve('ANC-73', 'strategist') → spawn

5. Strategist's workspace includes:
   - .claude/CLAUDE.md (strategist persona + memory)
   - Context from dispatch: "Auth now uses JWT refresh tokens..."
   - Link to parent issue ANC-42
```

---

## 4. Concurrency Model

### 4.1 Capacity Pools

```
Global Cap: 15 total sessions (configurable)

Per-Agent Caps (from config):
  engineer:   5 task slots + 1 duty slot = 6 max
  strategist: 3 task slots + 1 duty slot = 4 max
  ops:        3 task slots + 1 duty slot = 4 max
  ceo-office: 1 task slot  + 1 duty slot = 2 max

Task vs Duty isolation:
  - Duty slots are reserved — tasks cannot use them
  - Task slots are the primary pool
  - If task pool full, task goes to queue
  - Duties never queue (if duty slot busy, skip this cycle)
```

### 4.2 Eviction Policy

When capacity is full and a higher-priority task needs to run:

```
Priority: Evict idle sessions first, then consider active

1. Find idle sessions (tmux dead, workspace preserved)
   - Sort by: HANDOFF processed (yes first), then oldest first
   - Evict → status: suspended, write SUSPEND.md

2. If no idle sessions, find lowest-priority active session
   - Never evict CEO-assigned tasks (priority 1)
   - Never evict tasks running < 2 minutes (warm-up grace)
   - Graceful suspend: ask agent to write SUSPEND.md, wait 3s, kill

3. If nothing evictable → queue the new task
```

### 4.3 Race Condition Prevention

**All session mutations go through Resolve Gate.** The gate is NOT concurrent — it processes one resolve call at a time (simple async mutex).

```typescript
class ResolveLock {
  private queue: Array<() => void> = []
  private locked = false

  async acquire(): Promise<void> {
    if (!this.locked) {
      this.locked = true
      return
    }
    return new Promise(resolve => this.queue.push(resolve))
  }

  release(): void {
    const next = this.queue.shift()
    if (next) next()
    else this.locked = false
  }
}
```

This prevents: duplicate spawns, capacity overcommit, state corruption from concurrent webhook processing.

---

## 5. Failure Modes & Recovery

| Failure | Detection | Auto-Recovery | Manual Intervention |
|---------|-----------|--------------|-------------------|
| ANC server crash | launchd restarts | Scan tmux sessions, rebuild state | None needed |
| tmux session dies unexpectedly | on-tick health check | Mark failed, retry once | If retry fails: CEO Office handles |
| Rate limit (Claude API) | tmux output detection | Queue with backoff (60s → 30min) | Persistent: CEO Office alerts CEO |
| Auth token expired | API returns 401 | Attempt refresh | If refresh fails: CEO notified |
| SQLite corruption | Startup check | Delete and recreate (cache only) | None needed |
| Network partition (SSH to remote) | SSH command timeout | Retry 3x, then fail | CEO Office investigates |
| Budget exceeded | Pre-spawn check | Reject spawn, pause non-critical | CEO adjusts budget |
| Circuit breaker tripped | Breaker state check | CEO Office investigates | CEO resets or adjusts |
| Webhook flood | Gateway rate limiting | Drop excess, dedup | None needed |
| Disk full | Health check | Alert CEO, cleanup old workspaces | CEO frees space |

---

## 6. Security Model

### 6.1 Authentication

| Context | Auth Method |
|---------|------------|
| Dashboard (localhost) | None (trusted local) |
| Dashboard (remote) | Bearer token in `~/.anc/api-token` |
| Linear webhooks | HMAC signature verification |
| Agent SDK commands | Filesystem access (only from agent workspace) |
| Agent OAuth tokens | Per-agent files in `~/.anc/agents/{role}/.oauth-token` |

### 6.2 Secrets Storage

```
~/.anc/
├── api-token              # Dashboard auth token (generated by `anc setup`)
├── config.yaml            # Non-secret config (host, port, team IDs)
├── agents/
│   ├── engineer/.oauth-token   # Linear OAuth token for Engineer
│   ├── strategist/.oauth-token
│   ├── ops/.oauth-token
│   └── ceo-office/.oauth-token
└── integrations/
    ├── linear-api-key     # Linear personal API key
    ├── discord-token       # Discord bot token
    └── telegram-token      # Telegram bot token
```

**All secret files are 600 permission. `.gitignore` covers `~/.anc/` entirely.**

### 6.3 Agent Isolation

- Each agent runs in its own tmux session
- Each agent has its own workspace directory
- Agents communicate only through the SDK (CLI), never directly
- Agent OAuth tokens are scoped — Engineer cannot post as Strategist
- Agent workspaces are cleaned up after completion (configurable)

---

## 7. Configuration Hierarchy

```
Defaults (hardcoded)
  ↓ overridden by
config/*.yaml (shipped with ANC, version-controlled)
  ↓ overridden by
~/.anc/config.yaml (user-specific, not in git)
  ↓ overridden by
Environment variables (ANC_PORT, ANC_HOST, etc.)
  ↓ overridden by
CLI flags (--port, --host, etc.)
```

Precedence: CLI > env > user config > repo config > defaults.

---

## 8. Deployment Topology

### Local (Default)

```
MacBook
├── ANC Server (:3848)
│   ├── Gateway
│   ├── Event Bus
│   ├── Runtime Manager
│   └── Agent sessions (tmux)
├── Dashboard (same port, served by Gateway)
└── ~/.anc/ (state + memory + config)
```

### Local + Remote Execution

```
MacBook                              iMac (remote)
├── ANC Server (:3848)              ├── tmux sessions
│   ├── Gateway                     │   ├── anc-engineer-ANC-42
│   ├── Event Bus                   │   ├── anc-strategist-ANC-38
│   └── Runtime Manager ──SSH──────►│   └── anc-ops-pulse-...
├── Dashboard                       ├── ~/anc-workspaces/
└── ~/.anc/ (control)               └── ~/.anc/ (execution)
```

### Cloud (Future)

```
Cloud VM / Container
├── ANC Server (:3848, tunneled)
├── Dashboard (:3848, public)
├── Agent sessions (local tmux or Docker)
└── Persistent volume for ~/.anc/
```
