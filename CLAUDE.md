# ANC — Agent Native Company

One-person AI company operating system. CEO runs a team of AI agents via dashboard + native macOS app. Rebuilt from AgentOS with 65+ features (vs AgentOS ~35), event-driven architecture, real-time process capture.

## Quick Start

```bash
npm install && npm run build && npm link
ANC_BUDGET_DISABLED=true anc serve   # start gateway (unlimited budget for dev)
cd apps/web && npm run dev            # dashboard at localhost:3000
cd macos && xcodegen generate && xcodebuild -project ANC.xcodeproj -scheme ANC build  # native app
```

## Dev

```bash
npx tsx src/index.ts serve    # run backend without building
npx vitest run                # 425+ tests
cd apps/web && npx tsc --noEmit  # frontend typecheck
```

## Architecture

### Backend (src/)
- `bus.ts` — Typed EventEmitter (20+ event types, core nervous system)
- `gateway.ts` — HTTP webhook receiver + Linear signature verification → bus
- `api/routes.ts` — REST API (60+ endpoints) + `api/ws.ts` WebSocket real-time
- `api/hook-handler.ts` — Claude Code session hooks (process capture + cost ingestion)
- `routing/` — Declarative YAML routing rules + SQLite-backed priority queue + dedup/cooldown
- `runtime/runner.ts` — Interactive tmux session management (spawn/send-keys/resume/kill)
- `runtime/resolve.ts` — Dispatch gate (budget + capacity + circuit breaker + dedup + rate limit)
- `runtime/health.ts` — Session health monitor + auto-recovery from tmux
- `agents/` — Registry, composable persona builder (base + role + protocols + memory), SDK
- `hooks/` — 10 decoupled event handlers (issue, comment, session, completion, lifecycle, bridge, notifications)
- `core/tasks.ts` — First-class Task entity (CRUD, state machine with legal transitions, labels, assignee)
- `core/projects.ts` — Projects with health/priority/lead/targetDate
- `core/budget.ts` — Daily + per-agent spend limits, unlimited mode, cost series
- `core/review.ts` — Review policy (strict/normal/lax/autonomous/peer-review) per role/project/task
- `core/objectives.ts` + `decisions.ts` — OKRs + Decision Log
- `core/kill-switch.ts` — Global pause/resume all agents
- `core/briefing.ts` — Daily CEO briefing generator (real data: completions, queue, cost, risks)
- `core/labels.ts` — Label CRUD + task-label many-to-many
- `core/notifications.ts` — Inbox notifications with kind/severity filtering
- `core/personas.ts` — Persona file CRUD (path-traversal safe)
- `core/agent-roles.ts` — Custom agent role creation/archival
- `core/persona-tuner.ts` — AI scope overlap/gap analysis across personas
- `core/memory.ts` — Agent memory file CRUD
- `core/pricing.ts` — Token cost calculation from Claude Code transcripts
- `channels/` — Discord (bidirectional) + Telegram (outbound)
- `commands/sdk.ts` — Agent CLI: comment, dispatch, status, create-sub, plan, ask

### Frontend (apps/web/)
- Next.js 16 + Tailwind CSS 4 + shadcn/ui + framer-motion
- Apple-native palette (SF Pro, iOS blue, 3-layer shadows, SVG noise grain)
- 3-pane Tasks view (drag-to-resize, Linear-density rail, inline-edit properties)
- Projects table (9 columns, inline edit, detail 2-pane)
- Members/Agents (6-tab detail: Persona/Terminal/Memory/Sessions/Cost/Activity)
- Pulse dashboard (OKRs, Decisions, Briefing, Needs-Input, Wins, Kill Switch)
- Inbox (2-pane, filter tabs, mark read/archive)
- cmdk command palette + keyboard legend (27 shortcuts)
- @mention dispatch in comment composer
- Inline file preview (HTML iframe, Markdown, code, images)
- Process capture stream (real-time agent tool calls)
- WebSocket real-time updates

### macOS Native App (macos/)
- SwiftUI, macOS 14+, xcodegen project
- Full feature parity with web (Tasks, Projects, Members, Agents, Inbox, Pulse, Settings)
- Native menu bar, toolbar, keyboard shortcuts, dock badge, system notifications
- APIClient (async/await) + WebSocketClient (auto-reconnect)
- Build: `brew install xcodegen && cd macos && xcodegen generate && xcodebuild`

### Config (config/)
- `agents.yaml` — Agent roster (roles, models, concurrency, duty slots)
- `routing.yaml` — Declarative issue → agent routing rules
- `budget.yaml` — Daily + per-agent spend limits
- `review.yaml` — Review strictness per role/project
- `duties.yaml` — Standing duties (health checks, ops pulse)

### Personas (personas/)
- `base.md` — Shared base persona (all agents)
- `roles/*.md` — Per-agent persona (engineer, strategist, ops, ceo-office)
- `protocols/*.md` — Shared protocols (handoff, status-reporting, communication)

## Key Principles

- **Interactive claude sessions** — agents run in tmux interactively (not `-p` print mode), CEO can follow-up via comments piped as `tmux send-keys`
- **Event-driven** — all handlers decoupled via typed bus, 10 hook files run concurrently
- **Per-issue workspaces** — each task gets `~/anc-workspaces/<taskId>/`
- **Persona + memory grounding** — every spawn injects full persona + accumulated memory + protocols into workspace CLAUDE.md
- **HANDOFF/BLOCKED/SUSPEND protocol** — agent writes artifact → system detects → updates state + notifies CEO + auto-comments
- **Zero stubs** — every UI element must be functional end-to-end, no decorative placeholders
- **Process capture** — Claude Code hooks post every tool call to dashboard in real-time
- **Cost transparency** — real token extraction from transcripts, per-task USD in budget_log
- **Review gates** — configurable strictness: CEO can trust agents to auto-complete or require review

## Agent Roster

| Role | Owns | Model |
|------|------|-------|
| Engineer | Code, architecture, testing, code review | claude-code |
| Strategist | Product, strategy, research, content | claude-code |
| Ops | Monitoring, triage, alerting, deploy | claude-code |
| CEO Office | Health checks, briefings, agent recovery | claude-code |

Custom roles can be added via dashboard Settings → Agents → + New Role.

## Testing

```bash
npx vitest run                    # 425+ backend tests
cd apps/web && npx tsc --noEmit   # frontend typecheck
cd apps/web && npm run build      # Next.js production build
cd macos && xcodebuild ...        # macOS app build
```
