# ANC System Evolution Roadmap

## Context

ANC is at 3,446 lines / 28 files / 43 tests. The architecture is solid (event bus, resolveSession gate, 3-state lifecycle, dual capacity pools, duties engine). But it's **untested against real Linear API** and has several gaps that would cause failures in production.

This roadmap prioritizes by: what blocks running → what blocks reliability → what blocks growth.

## Current Gaps Audit

| Category | Gap | Severity |
|---|---|---|
| **State** | All state is in-memory Maps (6 Maps). Server restart = total amnesia | Critical |
| **Shutdown** | No SIGINT/SIGTERM handler. Abrupt kill = lost state | Critical |
| **Linear API** | GraphQL queries untested against real API. SDK method names may be wrong | Critical |
| **Auth** | No `anc setup` / `anc auth` command. Manual file copy needed | High |
| **Logging** | 83 console.log calls, no structured logging, no log file | High |
| **Errors** | 28 catch blocks, many silently swallow. No error aggregation | High |
| **Tunnel** | No cloudflared integration for webhook delivery | Medium |
| **Cost** | Zero token/cost tracking | Medium |
| **Metrics** | No performance data (time-to-complete, failure rates) | Medium |
| **Company** | No `anc company start/stop` for fleet management | Medium |
| **Testing** | 43 unit tests only. Zero integration tests. Zero Linear API mocks | Medium |

---

## Phase A: Go Live (get running on real Linear)

**Gate**: `anc serve` receives a real webhook, spawns an agent, agent posts comment back to Linear.

### A1. Setup automation (`anc setup`)
- New command: `anc setup` — interactive wizard
- Reads existing AgentOS tokens from `~/.aos/agents/*/` if present
- Creates `~/.anc/` directory structure
- Generates `.env` from user input (Linear API key, team ID)
- Validates Linear API key works
- ~80 lines, new file `src/commands/setup.ts`

### A2. Linear API integration fixes
- Test every GraphQL query in `sdk.ts` and `client.ts` against real Linear API
- Fix field names, query syntax, pagination
- The `@linear/sdk` typed client vs raw GraphQL: standardize on one approach
- Likely ~30 fixes across `client.ts` and `sdk.ts`

### A3. State persistence (SQLite)
- Replace the 6 in-memory Maps with SQLite-backed storage
- Tables: `sessions` (health.ts state), `breakers` (circuit-breaker.ts), `queue` (queue.ts)
- On startup: load from DB. On mutation: write-through
- DB at `~/.anc/state.db` with WAL mode
- **Key principle**: DB is a cache, Linear is still truth. DB can be deleted and rebuilt.
- New file `src/core/db.ts` ~120 lines
- Modify: health.ts, circuit-breaker.ts, queue.ts (replace Map operations with DB calls)

### A4. Graceful shutdown
- Add SIGINT/SIGTERM handlers in `index.ts`
- On shutdown: checkpoint WAL, close DB, log
- ~15 lines in index.ts

### A5. Webhook tunnel
- `anc tunnel` command: starts cloudflared, writes tunnel URL to `~/.anc/tunnel-url`
- Or: reuse existing `ryanwang.cc` reverse proxy with new path `/anc/webhook`
- LaunchAgent plist for running `anc serve` as daemon
- ~40 lines + plist file

**Estimated effort**: ~300 lines new code + ~100 lines fixes
**Duration**: 1 focused session

---

## Phase B: Production Hardening (reliable daily use)

**Gate**: ANC runs 48 hours unattended without crashes, handles 20+ issues.

### B1. Structured logging
- Replace 83 `console.log` calls with a logger
- Log levels: debug, info, warn, error
- Write to `~/.anc/logs/anc-{date}.log` + stdout
- Include timestamps, session ID, issue key in every log line
- New file `src/core/logger.ts` ~60 lines
- Modify: all 17 files that use console.log

### B2. Error handling audit
- Review all 28 catch blocks
- Silent catches → log at minimum, emit bus event if actionable
- Add global uncaught exception/rejection handler
- Add circuit breaker for Linear API rate limits (not just per-issue)
- ~50 lines of changes across files

### B3. Linear API rate limiting
- Add outbound rate limiter for Linear GraphQL calls
- Token bucket: max 50 req/min (Linear's limit)
- Queue excess requests with backoff
- New file `src/linear/rate-limiter.ts` ~40 lines

### B4. Integration test suite
- Real webhook payload → gateway → router → resolveSession → mock spawn
- Mock tmux (no real process) but real routing/lifecycle logic
- Linear API mocks (recorded responses)
- New file `tests/integration.test.ts` ~150 lines

### B5. Company mode
- `anc company start` — spawn all agents on their backlog
- `anc company stop` — graceful shutdown all sessions
- `anc company status` — fleet overview
- ~60 lines in `src/commands/company.ts`

**Estimated effort**: ~400 lines
**Duration**: 1-2 sessions

---

## Phase C: Operational Intelligence (self-managing)

**Gate**: ANC self-heals from common failures without CEO intervention.

### C1. Cost tracking
- Parse Claude Code output for token usage (if available in tmux capture)
- Or: estimate from session duration × model rate
- Track per-agent, per-issue, per-day
- DB table: `costs (session_id, role, issue_key, tokens, usd, timestamp)`
- Budget alerts: daily/weekly caps per role
- ~100 lines

### C2. Performance metrics
- Track: time-to-complete, completion rate, failure rate, queue wait time
- Per-agent and per-task-type breakdowns
- DB table: `metrics (key, value, timestamp)`
- Expose via `/metrics` endpoint (Prometheus-compatible or JSON)
- ~80 lines

### C3. Smart alert escalation
- Ops duty writes to Telegram when: failure rate > 30%, queue > 10, issue stuck > 48h
- Configurable thresholds in duties.yaml
- Different severity levels: info → warning → critical → Telegram
- ~40 lines (extend duties.yaml + telegram.ts)

### C4. Self-healing patterns
- Agent failed 3 times → auto-create "Debug: RYA-XXX" issue for Engineer
- Queue growing → auto-increase maxConcurrency temporarily
- Stale idle sessions (>24h) → auto-cleanup
- ~60 lines in on-tick.ts

**Estimated effort**: ~280 lines
**Duration**: 1 session

---

## Phase D: Intelligence Evolution (smarter agents)

**Gate**: Agents improve their own performance over time without code changes.

### D1. Prompt optimization pipeline
- A/B test different persona fragments
- Track completion quality per persona variant
- Auto-select winning variants
- Config: `config/experiments.yaml`
- ~120 lines

### D2. Multi-model runtime
- Codex adapter (alongside Claude Code)
- Per-task model selection (fast tasks → Haiku, complex → Opus)
- Config: per-role model preference + fallback chain
- New file `src/adapters/codex.ts` ~100 lines
- Modify: runner.ts (adapter selection logic)

### D3. Dynamic role creation
- Add new agent roles via `config/agents.yaml` without code changes
- Hot-reload: `anc agent reload` re-reads config
- Persona hot-swap: change persona files while agent is idle
- ~40 lines

### D4. Knowledge graph
- Replace flat memory files with structured knowledge
- Relations: "X depends on Y", "X is similar to Z", "X supersedes W"
- Query: "what does the agent know about authentication?"
- Could use SQLite FTS5 for search
- ~200 lines (new module `src/agents/knowledge.ts`)

**Estimated effort**: ~460 lines
**Duration**: 2-3 sessions

---

## Phase E: Product Layer (if ANC becomes a product)

**Gate**: Someone other than you can install and use ANC.

### E1. Documentation
- README with quickstart, architecture, config reference
- `docs/` directory with guides
- API reference for gateway endpoints

### E2. CLI polish
- Help text, error messages, onboarding wizard
- `anc doctor` — diagnose common issues (missing tokens, dead tmux, DB corruption)
- Color-coded output, progress spinners

### E3. Docker deployment
- Dockerfile + docker-compose.yml
- Bundled cloudflared + tmux
- Volume mounts for state + workspaces

### E4. CI/CD
- GitHub Actions: lint, type-check, test on PR
- Auto-publish npm package
- Version bumping

### E5. Plugin system
- Custom hook scripts (like AgentOS hooks/)
- Custom adapters (beyond Claude Code / Codex)
- Custom duty triggers (webhook-based)

### E6. Multi-tenancy (if SaaS)
- Per-tenant config isolation
- Shared infrastructure, separate state
- Usage metering + billing

---

## Recommended Priority Order

```
Now:     A1 → A2 → A3 → A4 → A5   (Go Live — one session)
Week 1:  B1 → B2 → B3 → B4 → B5   (Hardening — after 2 days running)
Week 2:  C1 → C2 → C3 → C4         (Intelligence — driven by real data)
Month 1: D1 → D2 → D3              (Evolution — based on agent feedback)
Month 2: E1 → E2 → E3              (Product — if pursuing open source launch)
Future:  D4, E4, E5, E6            (When business triggers justify)
```

Each phase has a clear gate — you don't start the next phase until the current phase's gate condition is met. This prevents over-engineering.

## Verification

After each phase:
1. `npx tsc --noEmit` — type check
2. `npx vitest run` — all tests pass
3. Phase-specific gate test (described above)
4. Commit + push

## What NOT to build (learned from AgentOS)

- **Dashboard HTML** — Use Linear's built-in views. Custom dashboards become maintenance burden.
- **Swarm coordinator** — Premature complexity. Two focused agents > ten swarming agents.
- **Auto-deploy watcher** — Use `tsx --watch` or `nodemon`. Not worth custom code.
- **Complex OAuth flow** — Copy tokens from AgentOS. Full OAuth only if shipping as product.
- **Planner/decomposition** — Agents decompose via `anc create-sub`. No LLM-in-the-loop needed.
