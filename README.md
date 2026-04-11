# ANC -- Agent Native Company

> One person + AI agents = a fully operational company.

[![CI](https://github.com/zzhiyuann/anc/actions/workflows/ci.yml/badge.svg)](https://github.com/zzhiyuann/anc/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/anc)](https://www.npmjs.com/package/anc)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/zzhiyuann/anc)](https://github.com/zzhiyuann/anc/stargazers)

## What is ANC?

ANC is an AI company operating system. You make the strategic decisions as CEO. AI executives -- an Engineer, a Strategist, an Ops lead, and a CEO Office agent -- pick up tasks, execute autonomously, and report back. Each agent has persistent memory that grows over time, so your company gets smarter with every task.

Think of it as hiring a team that never sleeps, learns from every project, and coordinates through your existing tools (Linear, Discord, Telegram).

## How It Works

```
You (CEO)                      ANC                              Agents
   |                            |                                  |
   |-- create task in Linear -->|                                  |
   |                            |-- route to best agent ---------->|
   |                            |                                  |-- work autonomously
   |                            |                                  |-- commit code / write docs
   |                            |<-- completion report ------------|
   |<-- review in Linear/web --|                                  |
```

**The Agent Roster:**

| Role | What they do |
|------|-------------|
| **Engineer** | Writes code, fixes bugs, reviews PRs, runs tests |
| **Strategist** | Product strategy, market research, roadmaps, content |
| **Ops** | System health, issue triage, failure postmortems |
| **CEO Office** | Monitors other agents, escalates blockers, keeps you informed |

## Quick Start

```bash
git clone https://github.com/zzhiyuann/anc.git && cd anc
npm install && npm run build && npm link
anc setup        # configure credentials
anc serve        # start your company
```

Open **http://localhost:3848** -- your company is running.

## Features

- **Persistent Agent Memory** -- agents remember past work and improve over time
- **Event-Driven Architecture** -- webhooks and events trigger work, no wasted cycles
- **CEO Office Agent** -- auto-monitors other agents, escalates issues (industry first)
- **Composable Personas** -- define agent behavior in YAML, no code changes needed
- **Priority Queue with Circuit Breaker** -- graceful failure handling with exponential backoff
- **Web Dashboard** -- real-time visibility into what every agent is doing
- **Linear / Discord / Telegram Sync** -- meet your agents where you already work
- **Budget Tracking** -- monitor API costs across all agents
- **Multi-Runtime Support** -- Claude Code (primary), with Aider and Gemini planned

## Screenshots

<!-- TODO: dashboard screenshot -->
<!-- TODO: terminal session screenshot -->
<!-- TODO: Linear integration screenshot -->

Screenshots coming soon.

## Architecture

```
                    +---------------------------------------------+
                    |                ANC Server                    |
                    |                                              |
  Linear --webhook->  Gateway --> Event Bus --> Router             |
  Discord --------->    :3849      (typed)      (YAML rules)      |
                    |                  |                           |
                    |                  v                           |
                    |  +------------------------------+           |
                    |  |          Runtime              |           |
                    |  |  Runner . Health . Workspace  |           |
                    |  |  Circuit Breaker . Queue      |           |
                    |  +----------+-------------------+           |
                    +-------------|------------------------------- +
                                  |
                    +-------------v-------------------+
                    |     tmux sessions (per issue)    |
                    |                                  |
                    |  +---------+ +---------+        |
                    |  | Claude  | | Claude  |  ...   |
                    |  | Code    | | Code    |        |
                    |  | (eng)   | | (ops)   |        |
                    |  +---------+ +---------+        |
                    |  ~/anc-workspaces/ANC-42/       |
                    +---------------------------------+
```

**Core components:**

| Component | Path | Role |
|-----------|------|------|
| Event Bus | `src/bus.ts` | Typed EventEmitter -- the nervous system. All handlers run concurrently with error isolation |
| Gateway | `src/gateway.ts` | HTTP webhook receiver. Verifies Linear signatures, emits events |
| Router | `src/routing/` | Declarative YAML routing: @mentions, reply chains, labels, title patterns |
| Runtime | `src/runtime/` | Session lifecycle, workspace isolation, circuit breaker, capacity management |
| Agents | `src/agents/` | Registry from YAML, composable persona builder, persistent memory |
| Hooks | `src/hooks/` | Event handlers for issues, comments, sessions, completions |
| Channels | `src/channels/` | Discord (bidirectional) + Telegram (outbound alerts) |

**Key design decisions:**

1. **Linear is the source of truth** -- local state is disposable cache, everything recoverable from the issue tracker
2. **Per-issue workspace isolation** -- each issue gets its own git worktree, no cross-contamination
3. **YAML over code** -- routing rules, agent roster, and proactive duties are all config-driven
4. **Composable personas** -- small reusable fragments (base + role + protocols + memory) assembled at spawn time
5. **Event bus over direct coupling** -- components communicate through typed events
6. **Claude Code as runtime** -- leverages built-in tool use, file editing, and terminal access

## Documentation

- [Getting Started](docs/getting-started.md) -- installation, configuration, first run
- [Architecture](docs/ARCHITECTURE.md) -- deep dive into system design
- [Design](docs/DESIGN.md) -- design philosophy and trade-offs
- [Vision](VISION.md) -- full roadmap and long-term direction
- [CEO Guide](docs/CEO-GUIDE.md) -- how to operate your AI company

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

[MIT](LICENSE)
