# ANC — Agent Native Company

Run your company with AI agents. ANC is a Linear-native orchestration platform that spawns autonomous Claude Code agents to work on issues — engineering, strategy, and operations — with per-issue workspace isolation, event-driven coordination, and declarative YAML configuration.

```
Linear issue created → webhook → ANC routes to agent → Claude Code spawns in isolated workspace → work done → HANDOFF.md posted back to Linear
```

## Why ANC

Most AI agent frameworks are chatbot wrappers. ANC is built differently:

- **Linear is the source of truth** — issues, comments, and status drive everything. Local state is disposable cache.
- **Per-issue isolation** — each issue gets its own workspace with a git worktree. No cross-contamination between tasks.
- **Event-driven, not polling** — webhooks and bus events trigger work. No patrol loops, no wasted cycles.
- **Agents coordinate through Linear** — they comment, dispatch work to each other, and create sub-issues using their own OAuth tokens.
- **Declarative configuration** — routing rules, agent roster, and proactive duties are all YAML. Add new behaviors without writing code.

## Architecture

```
                    ┌─────────────────────────────────────────────┐
                    │                ANC Server                   │
                    │                                             │
  Linear ──webhook──▶  Gateway ──▶ Event Bus ──▶ Router          │
  Discord ─────────▶    :3849      (typed)       (YAML rules)    │
                    │                  │                          │
                    │                  ▼                          │
                    │  ┌──────────────────────────────┐          │
                    │  │          Runtime              │          │
                    │  │  Runner · Health · Workspace  │          │
                    │  │  Circuit Breaker · Queue      │          │
                    │  └──────────┬───────────────────┘          │
                    └─────────────┼───────────────────────────────┘
                                  │
                    ┌─────────────▼───────────────────┐
                    │     tmux sessions (per issue)    │
                    │                                  │
                    │  ┌─────────┐ ┌─────────┐       │
                    │  │ Claude  │ │ Claude  │  ...   │
                    │  │ Code    │ │ Code    │        │
                    │  │ (eng)   │ │ (ops)   │        │
                    │  └─────────┘ └─────────┘       │
                    │  ~/anc-workspaces/ANC-42/       │
                    └─────────────────────────────────┘
```

**Core components:**

| Component | Path | Role |
|-----------|------|------|
| Event Bus | `src/bus.ts` | Typed EventEmitter — the nervous system. All handlers run concurrently with error isolation |
| Gateway | `src/gateway.ts` | HTTP webhook receiver. Verifies Linear signatures, emits events, serves `/health`, `/status`, `/events` |
| Router | `src/routing/` | Declarative YAML routing: @mentions, reply chains, labels, title patterns, assignees |
| Runtime | `src/runtime/` | Session lifecycle (active/idle/suspended), workspace isolation, circuit breaker, capacity management |
| Agents | `src/agents/` | Registry from YAML, composable persona builder (base + role + protocols + memory) |
| Hooks | `src/hooks/` | Event handlers for issues, comments, sessions, completions, duties |
| Channels | `src/channels/` | Discord (bidirectional) + Telegram (outbound alerts) |

## Agent Roster

Three agents with distinct roles, expandable via `config/agents.yaml`:

| Role | Scope | What they do |
|------|-------|--------------|
| **Engineer** | Code, architecture, testing | Implements features, fixes bugs, reviews code, runs tests |
| **Strategist** | Product, research, content | Writes strategy docs, market analysis, research, roadmaps |
| **Ops** | Monitoring, triage, alerting | System health checks, issue triage, failure postmortems |

Each agent has its own Linear identity, OAuth token, capacity limits, and composable persona assembled from reusable fragments.

## How It Works

**1. Issue arrives** — A Linear issue is created or commented on. The webhook hits ANC's gateway.

**2. Routing** — Declarative rules decide which agent handles it:
```yaml
# config/routing.yaml
issue_routing:
  - label: "Bug"        → engineer
  - label: "Feature"    → engineer
  - label: "Plan"       → strategist
  - titlePattern: "\\[Strategy\\]" → strategist
  issue_default: ops

comment_routing:
  - match: "@{agent}"         # @engineer mentioned
  - match: reply_to_agent     # reply to agent's comment
  - match: has_assignee       # issue assignee
  - match: last_active        # last agent who touched it
```

**3. Workspace creation** — Each issue gets an isolated workspace:
```
~/anc-workspaces/ANC-42/
  .claude/CLAUDE.md     # assembled persona + instructions
  .agent-memory/        # symlinked persistent memory
  code/                 # git worktree (isolated branch)
  HANDOFF.md            # completion checkpoint
```

**4. Agent execution** — Claude Code spawns in a tmux session with the assembled persona. The agent reads the issue, plans, implements, tests, and writes `HANDOFF.md` when done.

**5. Completion** — ANC detects `HANDOFF.md`, posts it as a Linear comment, updates issue status, and frees the capacity slot.

**6. Coordination** — Agents talk to each other through Linear using the SDK:
```bash
anc comment ANC-42 "Found the root cause, fixing now"
anc dispatch strategist ANC-42 "Need product input on this UX decision"
anc create-sub ANC-42 "Tech debt: refactor auth middleware" "Found during bug fix"
anc handoff engineer ANC-42 "Strategy defined, ready for implementation"
```

## Session Lifecycle

Sessions have three states, enabling efficient resource use:

| State | Resources | Resumable | Counts toward capacity |
|-------|-----------|-----------|----------------------|
| **Active** | tmux + Claude running | — | Yes |
| **Idle** | Workspace preserved, tmux exited | `--continue` | No |
| **Suspended** | Workspace + `SUSPEND.md` preserved | `--continue` | No |

Idle sessions consume zero resources but can be reactivated instantly when a new comment arrives.

## Proactive Duties

Agents don't just react — they run scheduled duties defined in YAML:

```yaml
# config/duties.yaml
duties:
  - id: company-pulse
    role: ops
    trigger:
      cron: "2h"
    prompt: "Run system health check, report anomalies"

  - id: failure-postmortem
    role: ops
    trigger:
      event: "agent:failed"
    prompt: "Investigate why {role} failed on {issueKey}"
```

Duties use a separate capacity pool (`dutySlots`) so they never starve reactive work.

## Reliability

- **Circuit breaker** — Per-issue failure tracking with exponential backoff (60s → 120s → ... → 30min). Prevents infinite retry storms.
- **Queue with dedup** — Priority queue with per-role deduplication. Work drains when capacity opens.
- **Dual capacity pools** — Reactive tasks and proactive duties have independent limits.
- **Error isolation** — A failing event handler never crashes the bus or other handlers.
- **Linear as recovery source** — All state reconstructable from Linear. The SQLite DB is an optional cache.

## Getting Started

### Prerequisites

- Node.js 20+
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed
- A [Linear](https://linear.app) workspace with API access
- tmux

### Install

```bash
git clone https://github.com/zzhiyuann/anc.git
cd anc
npm install
npm run build
npm link    # makes `anc` available globally
```

### Configure

Copy the example environment file and fill in your credentials:

```bash
cp config/env.example .env
```

Required variables:

| Variable | Description |
|----------|-------------|
| `ANC_LINEAR_API_KEY` | Linear API key |
| `ANC_LINEAR_TEAM_ID` | Linear team UUID |
| `ANC_LINEAR_TEAM_KEY` | Team key prefix (e.g., `ANC`) |
| `ANC_WEBHOOK_SECRET` | Webhook signing secret |
| `ANC_WORKSPACE_BASE` | Where workspaces are created (default: `~/anc-workspaces`) |

Optional: `ANC_DISCORD_BOT_TOKEN`, `ANC_TELEGRAM_BOT_TOKEN`, `ANC_WEBHOOK_PORT`

### Setup

```bash
anc setup    # creates directories, validates credentials
```

### Run

```bash
anc serve                    # start gateway + event handlers
anc status                   # view system overview
anc agent list               # show roster + capacity
anc agent start engineer ANC-42   # manually spawn an agent on an issue
```

Point your Linear webhook to `http://your-server:3849/webhook` (use [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) for tunneling).

## Development

```bash
npx tsx src/index.ts serve   # run without building
npx vitest run               # run tests (127 tests)
npx vitest                   # watch mode
```

## Project Structure

```
src/
  index.ts              # CLI entry point (commander)
  bus.ts                # Typed event bus
  gateway.ts            # HTTP webhook receiver
  routing/
    router.ts           # Routing decision engine
    rules.ts            # YAML rule loader
    queue.ts            # Priority queue with dedup
  runtime/
    resolve.ts          # Session resolution (dedup/resume/reactivate/spawn)
    runner.ts           # tmux process management (spawn/suspend/kill/capture)
    health.ts           # Session state machine + capacity
    workspace.ts        # Per-issue workspace creation
    circuit-breaker.ts  # Failure tracking + backoff
  agents/
    registry.ts         # Agent roster from YAML
    persona.ts          # Composable prompt builder
    sdk.ts              # Agent SDK (Linear operations)
    sdk-cli.ts          # CLI wrapper for SDK
  hooks/                # Event handlers
  channels/             # Discord + Telegram
  core/
    db.ts               # SQLite (WAL mode, backups)
  linear/
    client.ts           # Linear GraphQL client

config/
  agents.yaml           # Agent roster definition
  routing.yaml          # Declarative routing rules
  duties.yaml           # Proactive duty schedules
  env.example           # Environment template

personas/
  base.md               # Shared instructions
  roles/                # Per-role persona fragments
  protocols/            # Reusable protocol fragments (completion, memory, comms)
```

## Key Design Decisions

1. **Linear over local state** — Agents write to Linear, not local files. Everything is recoverable from the issue tracker.
2. **Workspace isolation over shared context** — Git worktrees per issue. Agents can't accidentally affect each other's work.
3. **YAML over code for behavior** — Routing, duties, and roster changes don't require deploys.
4. **Composable personas over monolithic prompts** — Small reusable fragments (base + role + protocols + memory) assembled at spawn time.
5. **Event bus over direct coupling** — Components communicate through typed events. Adding a new handler is one function.
6. **Claude Code over custom LLM integration** — Leverages Claude Code's built-in tool use, file editing, and terminal access instead of reimplementing them.

## License

MIT

## Author

Zhiyuan Wang
