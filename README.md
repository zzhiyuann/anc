<h1 align="center">ANC — Agent Native Company</h1>

<p align="center">
  <strong>Stop using agents. Start running a company.</strong>
</p>

<p align="center">
  One founder. Full org chart. Every seat filled by AI that remembers, grows, and self-heals.
</p>

<p align="center">
  <a href="https://github.com/zzhiyuann/anc/actions/workflows/ci.yml"><img src="https://github.com/zzhiyuann/anc/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://www.npmjs.com/package/anc"><img src="https://img.shields.io/npm/v/anc" alt="npm version" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT" /></a>
  <a href="https://github.com/zzhiyuann/anc/stargazers"><img src="https://img.shields.io/github/stars/zzhiyuann/anc" alt="GitHub stars" /></a>
</p>

---

Devin is a contractor. Codex is a tool. **ANC is the company they work for.**

ANC is an AI company operating system. You're the CEO. Your agents -- an Engineer, a Strategist, an Ops lead, and a self-healing CEO Office -- pick up tasks, write code, make decisions, and report back. They remember everything. They get better every sprint. They coordinate without you in the loop.

## Get Started in 60 Seconds

```bash
git clone https://github.com/zzhiyuann/anc.git && cd anc
npm install && npm run build && npm link
anc setup        # one-time wizard for Linear API key, Discord webhook, etc.
anc serve        # gateway on :3849 — your company is now running
```

Then in a second terminal:

```bash
cd apps/web && npm run dev
```

Open **http://localhost:3000** to see your command center.

> [Full setup guide &#8594;](docs/getting-started.md)

## How It Works

You create a task. ANC routes it to the right agent. The agent works in its own isolated workspace, commits code, and reports back. If it gets stuck, the CEO Office agent intervenes automatically. You review when you want to -- or don't, if you've set the agent to autonomous.

```
You (CEO)                        ANC                              Agents
   |                              |                                  |
   |-- "Build the auth module" -->|                                  |
   |                              |-- routes to Engineer ----------->|
   |                              |                                  |-- clones repo
   |                              |                                  |-- writes code
   |                              |                                  |-- runs tests
   |                              |                                  |-- commits + pushes
   |                              |<-- "Done. PR ready." ------------|
   |<-- notification ------------|                                  |
   |                              |                                  |
   |                     CEO Office (watching)                       |
   |                     -- health checks every 30m                  |
   |                     -- auto-recovers stuck agents               |
   |                     -- escalates only what matters              |
```

## Why ANC

### Your agents have memory

Every agent accumulates knowledge across tasks. The Engineer remembers your codebase conventions. The Strategist remembers your market positioning. They write retrospectives after each task and inject those learnings into future work. **Your company gets smarter every day.**

### Your company self-heals

The CEO Office agent monitors all other agents in real-time. Stuck process? Auto-restart. Rate limited? Exponential backoff. Three failures? Circuit breaker. Budget blown? Pause and alert. You only hear about things that actually need your decision.

### You control the trust level

Not every task needs your sign-off. Configure review policy per role, per project, or per task:

| Level | What happens |
|-------|-------------|
| **Strict** | Agent submits for review. You approve. |
| **Normal** | Agent submits. Auto-approved after 24h if you don't respond. |
| **Lax** | Auto-completed. You're notified. |
| **Autonomous** | Auto-completed. No notification. |
| **Peer Review** | Another agent reviews before completion. |

### Everything is config, not code

Agents, routing rules, review policies, standing duties, budgets -- all defined in YAML. Add a new agent role in 30 seconds. Change routing rules without touching code. Your company structure is a config file.

## The Team

| Role | Responsibilities |
|------|-----------------|
| **Engineer** | Code, architecture, testing, code review, debugging |
| **Strategist** | Product strategy, market research, roadmaps, content |
| **Ops** | System health, issue triage, failure analysis, deploys |
| **CEO Office** | Monitors agents, generates briefings, recovers failures, escalates blockers |

Need more roles? Add them in the dashboard or in `config/agents.yaml`. Each role gets its own composable persona -- a set of reusable instruction fragments that define how it thinks and works.

## Dashboard

A real-time command center for your company. Not a task board -- a CEO cockpit.

| View | What it shows |
|------|--------------|
| **Command Center** | KPIs, agent status grid, quick actions |
| **Tasks** | Three-pane Linear-density workspace with inline editing |
| **Agents** | Per-agent detail: persona, live terminal, memory, sessions, cost |
| **Pulse** | OKRs, decisions log, daily briefing, kill switch |
| **Memory** | Browse and search all agent + shared company knowledge |
| **Inbox** | Escalations, briefings, alerts -- filtered by severity |

Plus: `Cmd+K` command palette, 27 keyboard shortcuts, real-time process capture stream, drag-to-resize panes.

> Native macOS app available -- same features, native performance. Build via `cd macos && xcodegen generate && open ANC.xcodeproj`.

## Architecture

```
┌─────────────────────────────────────────────────┐
│  Dashboard (Web + macOS)                        │
│  Real-time WebSocket, REST API                  │
├─────────────────────────────────────────────────┤
│  ANC Server (:3849)                             │
│  Event Bus → Router → Resolve Gate → Runtime    │
│  Priority Queue · Budget · Circuit Breaker      │
├──────────┬──────────┬───────────┬───────────────┤
│  Linear  │ Discord  │ Telegram  │ GitHub        │
│  (sync)  │ (bridge) │ (alerts)  │ (PRs)         │
└──────────┴──────────┴───────────┴───────────────┘
         ┌──────────────────────────┐
         │  Isolated Workspaces     │
         │  tmux + Claude Code      │
         │  per-task git worktree   │
         └──────────────────────────┘
```

> [Full architecture deep dive &#8594;](docs/ARCHITECTURE.md)

## Documentation

| Guide | For |
|-------|-----|
| [Getting Started](docs/getting-started.md) | Installation, first run, your first task |
| [Quick Start](docs/QUICKSTART.md) | Condensed setup checklist |
| [CEO Guide](docs/CEO-GUIDE.md) | Day-to-day operations as the CEO |
| [Architecture](docs/ARCHITECTURE.md) | System design and internals |
| [Roadmap](docs/ROADMAP.md) | What's shipping next |

## Compared To

ANC sits one layer above the coding agents (Devin, Codex, Cursor, Claude Code) and adjacent to other orchestration platforms (Multica). The agents do the work; ANC is the company they work inside.

| | ANC | Multica | Devin | Codex |
|---|---|---|---|---|
| **Category** | Company OS | Agent orchestration | Managed agent | Cloud agent |
| **Persistent memory + retrospectives** | ✅ | Limited | ❌ | ❌ |
| **Self-healing meta-agent** | ✅ CEO Office | ❌ manual | ❌ manual | ❌ manual |
| **Configurable review policy** | ✅ 5 levels | Manual | Manual | Manual |
| **Native macOS app** | ✅ shipping | Web only | Web only | Web only |
| **Self-hosted** | ✅ MIT | ✅ MIT | ❌ | ❌ |
| **Brings your own agents** | ✅ Claude Code (more soon) | ✅ multi-vendor | n/a | n/a |

## Contributing

Contributions welcome. Open an issue or PR at [github.com/zzhiyuann/anc](https://github.com/zzhiyuann/anc).

```bash
npx vitest run                   # backend tests
cd apps/web && npx tsc --noEmit  # frontend typecheck
```

## License

[MIT](LICENSE)
