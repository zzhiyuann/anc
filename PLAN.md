# ANC — Execution Plan (Practical)

> Vision stays ambitious. Execution stays incremental.
> Rule: every commit should leave the system more stable than before.

---

## Current State

- 65 commits, ~7000 LOC TypeScript, single package
- Event bus, resolve gate, circuit breaker, composable personas — all working
- Linear AgentSession integration — **BROKEN** (6 fix attempts, still flaky)
- Queue exists but basic (in-memory, no priority)
- No budget tracking
- No API layer (only webhook endpoint + some /health routes)
- No GUI
- No CEO Office Agent
- Missing AgentOS features: priority queue, budget, batch, enhanced persona

## Principles

1. **Fix before add** — stabilize the core loop before building new features
2. **Incremental, not rewrite** — enhance existing files, don't recreate from scratch
3. **Single package until it hurts** — no monorepo until >15000 LOC
4. **Web first, native later** — Next.js dashboard, Mac/iOS is Phase 4+
5. **Claude Code only** — RuntimeAdapter interface as design constraint, no other implementations yet

---

## Phase 1: Core Stabilization

### 1.1 Fix Linear Integration (CRITICAL)

**Decision: Drop AgentSession API entirely. Switch to comment-based sync.**

Why: The AgentSession API has fundamental limitations (10s timeout, read-only state,
dismissedAt is internal-only). 6 fix attempts failed. Stop fighting the API.

Files to modify:
- `src/hooks/on-session.ts` — gut it. Only handle comment-based mentions
- `src/hooks/on-lifecycle.ts` — remove all AgentSession dismiss logic
- `src/linear/client.ts` — remove emitActivity, dismissSession; add postComment, syncStatus
- `src/gateway.ts` — stop routing AgentSessionEvent webhooks

What replaces it:
- Agent picks up issue → posts comment "🔄 Working on this..."
- Agent completes → posts comment with summary + updates status
- Agent status visible via comments, not "Working..." badge
- 100% reliable, no timeout issues

### 1.2 Verify Core Loop End-to-End

After Linear fix, verify this flow works cleanly:
```
Create issue → webhook → route → resolve → spawn → agent works →
HANDOFF.md → complete → parse actions → status update → comment posted →
dispatch sub-issue (if any) → sub-agent spawns → completes → parent updated
```

Test with real Linear issue. Every step must work or we don't proceed.

### 1.3 Port AgentOS Features (Incremental)

Add to EXISTING files, don't create new modules:

**Priority Queue** (enhance `src/routing/queue.ts`):
- Add SQLite persistence (use existing `src/core/db.ts`)
- Add priority field (role-based: CEO-assigned=1, dispatch=3, duty=5)
- Add delay_until for backoff
- Add cooldown support
- ~150 lines of changes

**Budget Tracker** (new file: `src/core/budget.ts`):
- Load limits from `config/budget.yaml`
- canSpend() check before spawn in resolve.ts
- recordSpend() after completion
- bus.emit('system:budget-alert') when near limit
- ~100 lines

**Enhanced Persona** (enhance `src/agents/persona.ts`):
- Add cross-agent shared memory loading (~/.anc/memory/shared/)
- Add retrospective loading (last 3 from retrospectives/)
- Add importance-based sorting (parse frontmatter)
- Add worker persona (lightweight, no memory) for simple tasks
- ~80 lines of changes

**Batch Spawn** (new command in `src/commands/`):
- `anc batch ANC-1 ANC-2 ANC-3` — sequential spawn
- Simple loop, 5-second delay between spawns
- ~30 lines

### 1.4 API Layer (Add to Existing Gateway)

**Don't create new package.** Add routes to existing `src/gateway.ts`:

```
Existing:
  /webhook, /health, /health/detailed, /status, /events, /dispatch, ...

Add:
  /api/v1/agents          GET     — agent roster + status
  /api/v1/agents/:role    GET     — agent detail
  /api/v1/agents/:role/start   POST
  /api/v1/agents/:role/stop    POST
  /api/v1/agents/:role/talk    POST
  /api/v1/agents/:role/output  GET  — tmux output
  /api/v1/tasks           GET/POST
  /api/v1/tasks/:id       PATCH/DELETE
  /api/v1/queue           GET
  /api/v1/budget          GET
  /api/v1/memory/shared   GET
  /api/v1/memory/:role    GET
  /api/v1/briefings       GET

WebSocket:
  /ws — upgrade existing HTTP server, broadcast bus events
```

Extract API routes into `src/api/routes.ts` (one file, not a package).
Add WebSocket server alongside existing HTTP server in gateway.ts.

### 1.5 CEO Office Agent

New persona files:
- `personas/roles/ceo-office.md` — role definition
- Add to `config/agents.yaml` — register as agent

New duties in `config/duties.yaml`:
- `health-monitor` (every 30min) — check agents, queue, breakers, budget
- `agent-recovery` (on agent:failed) — diagnose and retry/escalate
- `daily-briefing` (every 24h) — summarize company status

Store briefings in SQLite (add `briefings` table to db.ts).

---

## Phase 2: Web Dashboard

**Separate Next.js app at `apps/web/`. Connects to core via HTTP + WebSocket.**

### Setup
```
apps/
└── web/
    ├── app/
    ├── package.json     # standalone Next.js, no monorepo dependency
    └── next.config.ts   # proxy /api/* to localhost:3848
```

No shared packages. Dashboard imports nothing from core.
Communicates only via REST API + WebSocket.

### Pages (in build order)

1. **Command Center** (home page)
   - 4 KPI cards (running / idle / queued / daily cost)
   - Agent status list (real-time via WebSocket)
   - Activity feed (recent events)
   - CEO briefing panel (latest from CEO Office)

2. **Tasks**
   - Kanban board (Backlog → Todo → In Progress → In Review → Done)
   - List view toggle
   - Create task (Cmd+N)
   - Assign to agent (dropdown or drag)

3. **Agents**
   - Agent profile cards
   - Live terminal output (WebSocket stream)
   - Talk to agent (input box)
   - Memory file list
   - Session history

4. **Memory Explorer**
   - Browse by agent / shared
   - Search
   - Preview (markdown rendered)

5. **Settings**
   - Config editor (agents.yaml, routing.yaml, duties.yaml)
   - Budget settings
   - Integration toggles

### Tech
- Next.js 15 + Tailwind + shadcn/ui
- TanStack Query for API state
- Zustand for UI state (sidebar, filters)
- Native WebSocket (not socket.io)
- Dark theme first

---

## Phase 3: Polish & Ship

- Landing page (single page, Vercel)
- Documentation site (Fumadocs or Nextra)
- README rewrite (30-second pitch, 3-command quickstart, screenshots)
- GitHub Actions CI (build + test)
- Public launch: HN, Reddit, ProductHunt

---

## Phase 4+: Native Apps & Growth (Future)

- macOS app (Swift + SwiftUI) — only after web dashboard is proven
- iOS app — only after Mac app
- Multi-runtime adapters (Aider, Gemini) — only when needed
- Monorepo restructure — only when >15000 LOC
- Vector search for memory — only when keyword search isn't enough

---

## What NOT To Do

- Don't rewrite existing working code (bus, resolve gate, circuit breaker, hooks)
- Don't add monorepo infrastructure
- Don't implement adapters for runtimes we're not using
- Don't build native apps before web dashboard is solid
- Don't over-spec — code that works beats documentation that's perfect
