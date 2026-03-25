# ANC — Agent Native Company

Linear-native agent orchestration, rebuilt from AgentOS. 3 agents, event-driven, per-issue workspace isolation.

## Build & Run

```bash
npm install && npm run build && npm link
anc serve              # start gateway + event handlers
anc agent list         # show roster
anc agent start engineer RYA-42  # manual spawn
anc status             # system overview
```

## Dev

```bash
npx tsx src/index.ts serve   # run without building
npx vitest run               # run tests
```

## Architecture

- `src/bus.ts` — Typed EventEmitter (core nervous system)
- `src/gateway.ts` — Thin HTTP webhook receiver → bus
- `src/routing/` — Declarative YAML routing rules + priority queue
- `src/runtime/` — Workspace isolation (per-issue) + tmux runner + health
- `src/agents/` — Registry, composable persona builder, memory, SDK
- `src/hooks/` — Event handlers (issue, comment, session, completion, discord)
- `src/channels/` — Discord (bidirectional) + Telegram (outbound)
- `config/` — agents.yaml, routing.yaml, env.example
- `personas/` — Composable persona fragments (base + roles + protocols)

## Key Constraints

- **Linear is the single source of truth** — local state is disposable cache
- **Per-issue workspaces** — no sharing between issues, ever
- **Agents use `anc` CLI** (not MCP Linear tools) for all Linear operations
- **Event-driven** — handlers run concurrently via typed event bus
- **3 agents**: Engineer, Strategist, Ops (expandable via config)

## Agent Roster

| Role | Owns |
|------|------|
| Engineer | Code, architecture, testing, code review |
| Strategist | Product, strategy, research, content |
| Ops | Monitoring, triage, alerting, deploy |
