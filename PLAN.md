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

## Phase 2: GUI — Web + Native Mac App (Parallel)

**Two frontends, same API backend. Built in parallel.**

The web dashboard is the quick path — already scaffolded, connects to core API.
The Mac app is the product differentiator — Linear/Multica-level native experience.

### 2A: Web Dashboard (apps/web/)

Already scaffolded (Next.js + Tailwind + shadcn/ui).
Connect to real API, remove mock data, verify WebSocket real-time.

Pages: Command Center → Tasks → Agents → Memory → Settings

### 2B: Native Mac App (apps/macos/)

**This is not optional. A web-only product doesn't compete with Linear.**

Tech stack:
```
Swift 6 + SwiftUI
ANCKit (Swift Package) — shared API client + WebSocket + state store
Target: macOS 14+ (Sonoma)
```

Architecture:
```
apps/macos/ANC.app
├── ANCKit/                  # Swift Package (shared with iOS later)
│   ├── ANCClient.swift      # REST client (URLSession + async/await)
│   ├── ANCWebSocket.swift   # WebSocket (URLSessionWebSocketTask)
│   ├── Models.swift          # Codable types matching API responses
│   └── ANCStore.swift        # @Observable state store
│
├── Views/
│   ├── Sidebar.swift         # NSToolbar sidebar: Command Center, Tasks, Agents, Memory
│   ├── CommandCenter/        # KPI cards + agent status + activity feed
│   ├── TaskBoard/            # Kanban (LazyVGrid) + List toggle
│   ├── AgentDetail/          # Profile + live terminal (Text + monospace) + talk input
│   ├── MemoryExplorer/       # File browser + markdown preview
│   └── Settings/             # Form-based config editor
│
├── MenuBar/
│   ├── StatusBarItem.swift   # 🟢3 🟡1 🔴0 — always visible in menu bar
│   └── QuickMenu.swift       # Click → agent status dropdown
│
└── Features/
    ├── CommandPalette.swift   # ⌘K — search tasks, execute commands
    ├── Notifications.swift    # UNUserNotificationCenter for briefings/alerts
    └── KeyboardNav.swift      # j/k navigation, ⌘1-5 view switch
```

Build order:
1. ANCKit (API client + WebSocket + store) — foundation
2. Sidebar + Command Center — first visible screen
3. TaskBoard (Kanban) — core PM functionality
4. Agent Detail + live terminal — key differentiator
5. Menu Bar widget — always-on visibility
6. ⌘K command palette — power user feature
7. Memory Explorer + Settings — completeness

Design principles:
- Native macOS look: NSToolbar, sidebar, vibrancy, SF fonts
- No web tech smell: no loading spinners, no skeleton screens
- Instant feel: optimistic updates, local state, WebSocket push
- Keyboard-first: ⌘K, j/k, ⌘N, ⌘1-5
- Dark/light follow system appearance

---

## Phase 3: Polish & Ship

- Mac app: Memory Explorer, Settings, Widgets (WidgetKit)
- Web: feature parity with Mac app
- Landing page (single page, Vercel) with Mac app screenshots
- Documentation site (Fumadocs or Nextra)
- Demo video showing Mac app + agent working in Linear
- GitHub public release
- Public launch: HN ("Show HN: Native Mac app for managing AI agent teams"), Reddit, ProductHunt

---

## Phase 4+: Growth

- iOS app (SwiftUI, shares ANCKit with Mac app)
- Mac App Store distribution
- Multi-runtime adapters (Aider, Gemini) — when needed
- Vector search for memory
- Team/multi-user support
- Cloud hosted version

---

## What NOT To Do

- Don't rewrite existing working code (bus, resolve gate, circuit breaker, hooks)
- Don't add monorepo infrastructure until >15000 LOC
- Don't implement adapters for runtimes we're not using
- Don't over-spec — code that works beats documentation that's perfect
- Don't use Electron/Tauri — if we're doing Mac, do it properly with Swift
