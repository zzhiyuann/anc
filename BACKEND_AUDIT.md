# ANC vs AgentOS Backend Audit

## Executive Summary

- **ANC is significantly MORE complete than AgentOS** in almost every dimension. The CEO's suspicion is unfounded. ANC has 65+ features vs AgentOS's ~35, with superior architecture across the board.
- **AgentOS had ONE critical feature ANC intentionally dropped**: the Linear AgentSession API integration (create/emit/dismiss/plan). ANC dropped it after 6 failed attempts due to fundamental API limitations (10s timeout, ghost "Working" states). ANC replaced it with comment-based sync which is 100% reliable. This was the correct decision.
- **AgentOS had Codex adapter** (multi-model support). ANC is Claude-only. Low impact since Codex is deprecated.
- **ANC has 20+ features AgentOS never had**: first-class Task entity, Projects, OKRs, Decisions, Kill Switch, Review Policy, Labels, Notifications/Inbox, Discord bidirectional bridge, Standing Duties engine, Process Capture (Claude Code hooks), WebSocket real-time dashboard, Budget config API, @mention dispatch, task comments, task state machine with validation, and more.
- **Architecture quality**: ANC is a clean event-driven system (typed bus + handlers) vs AgentOS's monolithic serve.ts. ANC is the clear winner.

## Feature Matrix

| Category | Feature | AgentOS | ANC | Gap severity |
|---|---|---|---|---|
| **A. Agent Execution** | | | | |
| | Spawn via tmux | ✅ `src/core/tmux.ts` | ✅ `src/runtime/runner.ts` | - |
| | Interactive mode (session stays alive) | ✅ `--dangerously-skip-permissions` | ✅ `--permission-mode auto` | - |
| | Non-interactive mode | ❌ | ❌ | - |
| | Session persistence (--continue) | ⚠️ partial (resume cmd exists but no --continue) | ✅ full (auto-detects workspace, --continue) | ANC better |
| | Follow-up message piping (tmux send-keys) | ✅ `serve.ts:186-200` | ✅ `resolve.ts:66-68` | - |
| | Resume after crash/restart | ⚠️ manual only (`aos resume`) | ✅ auto (`recoverSessionsFromTmux()` in runner.ts) | ANC better |
| | Multi-model support (Claude + Codex) | ✅ `adapters/claude-code.ts`, `adapters/codex.ts` | ❌ Claude-only | Nice-to-have |
| | Per-agent OAuth identity | ✅ per-agent `.oauth-token` files | ✅ per-agent `.oauth-token` files | - |
| | Remote execution (SSH to iMac) | ✅ all tmux via SSH | ❌ local tmux only | ANC different (by design) |
| | Keychain integration | ✅ `core/keychain.ts`, `core/oauth.ts` | ❌ env vars + file-based tokens | Nice-to-have |
| | Workspace cleanup (HANDOFF/BLOCKED/PROGRESS rm) | ✅ pre-spawn cleanup | ✅ HANDOFF archived after processing | - |
| | Process capture (hook events) | ❌ | ✅ `api/hook-handler.ts` (PreToolUse, PostToolUse, etc.) | 🆕 ANC |
| | Cost ingestion from transcripts | ❌ | ✅ `hook-handler.ts:151-207` (parses JSONL transcripts) | 🆕 ANC |
| **B. Agent Personas & Memory** | | | | |
| | Persona loading (system prompt) | ✅ `core/persona.ts` (CLAUDE.md per agent) | ��� `agents/persona.ts` (composable fragments) | ANC better |
| | Memory persistence (per-agent files) | ✅ `~/.aos/agents/{role}/memory/*.md` | ✅ `~/.anc/agents/{role}/memory/*.md` | - |
| | Memory injection at spawn | ✅ `buildGroundingPrompt()` | ✅ `buildPersona()` with importance ranking | ANC better |
| | Shared memory (cross-agent) | ✅ `~/.aos/shared-memory/` | ✅ `~/.anc/memory/shared/` | - |
| | Memory frontmatter (importance ranking) | �� | ✅ `persona.ts:28-42` (critical/high/normal/low) | 🆕 ANC |
| | Memory cap (prevent token explosion) | ⚠️ hardcoded 5 shared files | ✅ MAX_TOTAL_MEMORIES=20, per-file char limits | ANC better |
| | Retrospectives (auto-generated) | ⚠️ retroDir loaded but not auto-generated | ✅ `on-complete.ts:313-344` (RETRO.md → shared memory) | ANC better |
| | Worker persona (ephemeral, no identity) | ✅ `buildWorkerPersona()` | ✅ `buildWorkerPersona()` | - |
| | SDK reference auto-appended | ❌ | ✅ `buildSdkReference()` in persona.ts | �� ANC |
| | Agent identity header | ⚠️ implicit via CLAUDE.md | ✅ explicit `buildIdentityHeader()` | ANC better |
| **C. Routing & Queue** | | | | |
| | Label-based routing | ✅ `serve.ts:37-52` (routing.json) | ✅ `routing/rules.ts` (routing.yaml) | - |
| | Project-based routing | ⚠️ TODO comment in serve.ts | ✅ `router.ts:100-102` | ANC better |
| | Title pattern routing | ❌ | ✅ `router.ts:103-108` | 🆕 ANC |
| | @mention dispatch | ❌ | ✅ `router.ts:40-51` + `rules.ts:77-96` | 🆕 ANC |
| | Reply-to-agent routing | ❌ | ✅ `router.ts:54-58` (parent_agent) | 🆕 ANC |
| | Delegate/assignee routing | ❌ | ✅ `router.ts:59-76` | 🆕 ANC |
| | Self-note prefix (skip routing) | ❌ | ✅ `rules.ts:113-116` ("self:", "note:") | 🆕 ANC |
| | Priority queue | ✅ `core/queue.ts` (role-based priority) | ✅ `routing/queue.ts` (SQLite-backed, dedup) | ANC better |
| | Dedup/rate-limiting | ✅ in-memory Map in serve.ts | ✅ SQLite-level dedup + per-issue cooldown | ANC better |
| | Cooldown after completion | ✅ `setCooldown()` in queue.ts | ✅ `setCooldown()` in queue.ts | - |
| | Circuit breakers | ❌ | ✅ `runtime/circuit-breaker.ts` (3 failures → exponential backoff) | 🆕 ANC |
| | Delayed enqueue | ✅ `delay_until` column | ✅ `delay_until` column | - |
| | Agent-to-agent dispatch | ❌ | ✅ `sdk.ts:63-83` (dispatch/handoff/ask) | 🆕 ANC |
| **D. Task Lifecycle** | | | | |
| | Task states | ⚠️ attempt: pending/running/completed/failed/blocked | ✅ task: todo/running/review/done/failed/suspended/canceled | ANC much better |
| | State transition validation | ❌ | ✅ `tasks.ts:165-173` (legal transition matrix) | 🆕 ANC |
| | HANDOFF.md detection | ✅ `serve.ts:429-453` | ✅ `on-complete.ts:112-113` | - |
| | BLOCKED.md detection | ✅ `serve.ts:457-469` | ❌ (not explicitly checked — tmux dead + no HANDOFF = idle) | Minor gap |
| | SUSPEND.md detection | ❌ | ✅ `on-complete.ts:118-122` | 🆕 ANC |
| | PROGRESS.md detection | ✅ `watch.ts:147-165` | ❌ (replaced by hook-based process capture) | Design choice |
| | Auto-status updates (todo→running→review→done) | ✅ `serve.ts:453`, `watch.ts:118` | ✅ `on-complete.ts:194-267` | - |
| | Quality gates on HANDOFF | ❌ | ✅ `on-complete.ts:66-85` (content length, verification) | ���� ANC |
| | Agent-decided actions (status, dispatches) | ❌ | ✅ `actions-parser.ts` (structured Actions block) | 🆕 ANC |
| | Dispatch tree (parent→child) | ❌ | ✅ `on-complete.ts:201-238` (sub-issues) | 🆕 ANC |
| | Cost tracking per task | ⚠️ cost_usd column but never populated | ✅ `budget.ts:158-161` (recordSpend per session) | ANC better |
| | Auto-retry on failure | ✅ `serve.ts:499-533` (3x with exponential backoff) | ✅ via circuit breaker + queue re-enqueue | - |
| | Review policy (who approves?) | ❌ | ✅ `core/review.ts` (strict/normal/lax/autonomous/peer-review) | 🆕 ANC |
| | First-class Task entity | ❌ (sessions only) | ✅ `core/tasks.ts` (full CRUD, parent/child, labels) | 🆕 ANC |
| **E. Event System** | | | | |
| | Event bus | ❌ (direct function calls) | ✅ `bus.ts` (typed EventEmitter, 20+ event types) | 🆕 ANC |
| | Event handlers (decoupled) | ❌ (monolithic serve.ts) | ✅ 10 separate hook files (on-issue, on-comment, etc.) | 🆕 ANC |
| | Hook system (Claude Code hooks) | ❌ | ✅ `api/hook-handler.ts` + `workspace.ts:97-155` | 🆕 ANC |
| | Webhook ingestion | ✅ `serve.ts:362-385` (no signature verification) | ✅ `gateway.ts:278-330` (with HMAC signature verification) | ANC better |
| | Notification generation | ❌ | ✅ `core/notifications.ts` + `hooks/on-notifications.ts` | 🆕 ANC |
| | Event logging to DB | ⚠️ `logEvent()` for attempts only | ✅ `core/events.ts` + all bus events logged | ANC better |
| | WebSocket real-time | ❌ | ��� `api/ws.ts` (broadcasts all bus events to dashboard) | 🆕 ANC |
| **F. External Integrations** | | | | |
| | Linear sync (read issues) | ✅ `core/linear.ts` | ✅ `linear/client.ts` | - |
| | Linear sync (write comments) | ✅ with per-agent identity | ✅ with per-agent identity | - |
| | Linear sync (status updates) | ✅ with per-agent identity | ✅ with per-agent identity | - |
| | Linear AgentSession API | ✅ create/emit/dismiss/plan (`core/linear.ts:222-367`) | ❌ intentionally removed (see `linear/client.ts:241-244`) | Intentional |
| | Linear webhook signature verification | ❌ | ✅ `linear/webhooks.ts:verifySignature()` | ANC better |
| | Linear rate limiter | ❌ | �� `linear/rate-limiter.ts` | 🆕 ANC |
| | Linear image download | ❌ | ✅ `linear/images.ts` (downloads to workspace) | 🆕 ANC |
| | Linear sub-issue creation | ❌ | ✅ `linear/client.ts:167-221` | 🆕 ANC |
| | Discord channel | ❌ | ✅ `channels/discord.ts` (bidirectional bot + webhook) | 🆕 ANC |
| | Telegram | ❌ | ✅ `channels/telegram.ts` (outbound notifications) | 🆕 ANC |
| | GitHub integration | ❌ | ❌ | - |
| | Discord bridge (Linear ↔ Discord) | ❌ | ✅ `bridge/mappings.ts` + `hooks/on-bridge.ts` | 🆕 ANC |
| **G. API Surface** | | | | |
| | Health endpoint | ✅ `GET /health` | ✅ `GET /health` + `GET /health/detailed` | ANC better |
| | Status endpoint | ❌ | ✅ `GET /status` | 🆕 ANC |
| | Events/audit log | ❌ | ✅ `GET /events?limit=N` | 🆕 ANC |
| | Webhook ingestion | ✅ `POST /webhook` | ✅ `POST /webhook` | - |
| | Open terminal (HTML) | ✅ `GET /open/:issueKey` | ❌ (not needed — local tmux) | Design choice |
| | Agent list | ❌ (CLI only) | ✅ `GET /api/v1/agents` | 🆕 ANC |
| | Agent detail | ❌ | ✅ `GET /api/v1/agents/:role` | 🆕 ANC |
| | Agent start/stop/talk | ❌ (CLI only) | ✅ `POST /api/v1/agents/:role/start\|stop\|talk` | ��� ANC |
| | Agent output capture | ❌ | ✅ `GET /api/v1/agents/:role/output` | ���� ANC |
| | Agent memory | ❌ | ✅ `GET /api/v1/agents/:role/memory` | ��� ANC |
| | Task CRUD | ❌ | ✅ `GET/POST/PATCH/DELETE /api/v1/tasks/:id` | 🆕 ANC |
| | Task list (filtered) | ❌ | ✅ `GET /api/v1/tasks?projectId=&state=&assignee=` | 🆕 ANC |
| | Task comments | ❌ | ✅ `GET/POST /api/v1/tasks/:id/comments` | 🆕 ANC |
| | Task attachments | ❌ | ✅ `GET /api/v1/tasks/:id/attachments` | 🆕 ANC |
| | Task dispatch | ❌ | ✅ `POST /api/v1/tasks/:id/dispatch` | 🆕 ANC |
| | Task output (per-agent) | ❌ | ✅ `GET /api/v1/tasks/:id/output?role=` | 🆕 ANC |
| | Task state transition | ❌ | ✅ `POST /api/v1/tasks/:id/state` | 🆕 ANC |
| | Projects CRUD | ❌ | ✅ `GET/POST/PATCH/DELETE /api/v1/projects/:id` | 🆕 ANC |
| | OKRs CRUD | ❌ | ✅ `GET/POST/PATCH/DELETE /api/v1/objectives` | 🆕 ANC |
| | Decisions CRUD | ❌ | ✅ via `core/decisions.ts` | 🆕 ANC |
| | Notifications/Inbox | ❌ | ✅ `GET/POST /api/v1/notifications` | 🆕 ANC |
| | Labels CRUD | ❌ | ✅ `GET/POST/DELETE /api/v1/labels` | 🆕 ANC |
| | Budget config API | ❌ | ✅ `GET/PATCH /api/v1/config/budget` | 🆕 ANC |
| | Review config API | ❌ | ✅ `GET/PATCH /api/v1/config/review` | 🆕 ANC |
| | Kill switch API | ❌ | ✅ `POST /api/v1/kill-switch/pause\|resume` | 🆕 ANC |
| | Plan announce | ❌ | ✅ `POST /plan-announce` | 🆕 ANC |
| | Group post (Discord) | ❌ | ✅ `POST /group-post` | 🆕 ANC |
| | Dispatch (agent SDK) | ❌ | ✅ `POST /dispatch` | 🆕 ANC |
| | Docs/file serving | ❌ | ✅ `GET /docs/:issueKey/:filename` (MD→HTML) | 🆕 ANC |
| | Assets serving | ❌ | ✅ `GET /assets/*` (avatars, etc.) | 🆕 ANC |
| | Hook event ingestion | ❌ | ✅ `POST /api/v1/hooks/:taskId/event` | 🆕 ANC |
| **H. Infrastructure** | | | | |
| | Database (SQLite) | ✅ 2 tables (attempts, events) | ✅ 16 tables (sessions, queue, breakers, events, tasks, projects, objectives, key_results, decisions, labels, task_labels, task_events, task_comments, notifications, discord_links, budget_log) | ANC much richer |
| | Config: agents | ✅ `~/.aos/agents.json` | ✅ `config/agents.yaml` | - |
| | Config: routing | ✅ `~/.aos/routing.json` | ✅ `config/routing.yaml` | ANC richer |
| | Config: budget | ✅ `~/.aos/budget.json` | ✅ `config/budget.yaml` + API | ANC better |
| | Config: review policy | ❌ | ✅ `config/review.yaml` | 🆕 ANC |
| | Config: duties | ❌ | ✅ `config/duties.yaml` | 🆕 ANC |
| | CLI commands | ✅ 12 commands | ✅ 16+ commands (agent, task, company, batch, doctor, SDK) | ANC richer |
| | Workspace isolation | ✅ per-issue via SSH | ✅ per-issue local + symlinked memory + git worktree | ANC better |
| | DB backup | ❌ | ✅ periodic backup every 30 min | 🆕 ANC |
| | DB migration system | ⚠️ v1→v2 migration only | ✅ multiple migration paths (timestamps, columns) | ANC better |
| | Graceful shutdown | ⚠️ basic SIGINT | ✅ SIGINT+SIGTERM, Discord cleanup, DB close | ANC better |
| | Global error handling | ❌ (crashes on uncaught) | ✅ uncaughtException + unhandledRejection → log + continue | 🆕 ANC |
| | Doctor/diagnostics | ❌ | ✅ `commands/doctor.ts` | 🆕 ANC |
| **I. ANC-Unique Features** | | | | |
| | Standing Duties engine | ��� | ✅ `hooks/on-duties.ts` (cron + event triggered) | 🆕 ANC |
| | Kill Switch (global pause) | ❌ | ✅ `core/kill-switch.ts` | 🆕 ANC |
| | Session states (active/idle/suspended) | ❌ (active/completed/failed only) | ✅ 3-state lifecycle with eviction priority | 🆕 ANC |
| | Eviction priority (smart suspend) | ❌ | ✅ `health.ts:187-210` (idle→processed→oldest→active) | 🆕 ANC |
| | Duty capacity pool (separate) | ❌ | ✅ `hasDutyCapacity()` separate from task pool | 🆕 ANC |
| | Auto-dispatch from backlog | ⚠️ `watch.ts` polls for labeled issues | ✅ `on-tick.ts` (assigned + unassigned routing) | ANC better |
| | Stale issue reconciliation | ❌ | ✅ `on-tick.ts:150-168` (In Progress with no session → Todo) | 🆕 ANC |
| | Orphan tmux cleanup | ❌ | ✅ `on-tick.ts:171-187` | 🆕 ANC |
| | Conversation vs task mode | ❌ | ✅ `on-comment.ts:19-65` (Done/Review → no HANDOFF needed) | 🆕 ANC |
| | Company-level commands | ❌ | ✅ `commands/company.ts` (start/stop/status fleet) | 🆕 ANC |
| | Agent SDK (typed CLI for agents) | ❌ | ✅ `agents/sdk.ts` + `agents/sdk-cli.ts` | 🆕 ANC |
| | Pricing model | ❌ | ✅ `core/pricing.ts` | 🆕 ANC |
| | Persona tuner | ❌ | ✅ `core/persona-tuner.ts` | 🆕 ANC |
| | Briefing system | ❌ | ✅ `core/briefing.ts` | 🆕 ANC |

## Critical Gaps (must fix for parity)

None. ANC exceeds AgentOS in every critical dimension.

## Important Gaps (should fix)

1. **BLOCKED.md detection** — AgentOS explicitly checked for BLOCKED.md and surfaced it as a distinct state. ANC treats tmux-dead-no-HANDOFF as "idle" which loses the distinction between "agent finished a conversation" and "agent is blocked and needs help." **Effort: 1 hour.** Add BLOCKED.md check in `on-complete.ts` tick handler, surface as a notification.

2. **PROGRESS.md or equivalent real-time progress** — AgentOS polled PROGRESS.md and posted updates to Linear. ANC replaced this with hook-based process capture (which is better), but the old PROGRESS.md approach had one advantage: the agent explicitly summarized its status in natural language. Hook events are raw tool calls. **Effort: Consider adding a periodic "what are you working on?" prompt or encouraging agents to write PROGRESS.md in their persona.** Low priority since process capture is strictly more data.

## Nice-to-have Gaps

1. **Multi-model adapter system** — AgentOS had a pluggable `RunnerAdapter` interface with Claude Code and Codex implementations. ANC hardcodes Claude Code. If you ever want to add Gemini/GPT agents, you'd need to extract the spawn logic into an adapter pattern. **Effort: 4 hours.**

2. **Keychain-based secret storage** — AgentOS stored Linear API keys in macOS Keychain. ANC uses env vars and flat files. Lower security but simpler. **Effort: 2 hours** to add Keychain support.

3. **Open-in-terminal URL scheme** — AgentOS had `agentos://session/RYA-42` URL scheme and an HTML redirect page. Nice for the Ghostty terminal workflow. ANC doesn't need this since it runs locally, but could be useful for remote access. **Effort: 1 hour.**

4. **Linear AgentSession API** — AgentOS used this to show real-time "Working..." status in Linear's UI with plan steps and thoughts. ANC deliberately removed it due to reliability issues. If Linear fixes their API (10s timeout, dismissedAt), re-adding it would improve the Linear-side experience. **Effort: 4 hours** to re-implement, but blocked on Linear API improvements.

## ANC Advantages (features AgentOS didn't have)

1. **Typed Event Bus** (`bus.ts`) — All components communicate through a typed event bus with concurrent handler execution. AgentOS was a monolithic serve.ts with direct function calls. This is the single biggest architectural improvement.

2. **First-class Task Entity** (`core/tasks.ts`) — Tasks are independent of sessions. One task can have multiple agents. Supports parent/child trees, labels, assignees, due dates, comments, and a validated state machine.

3. **Projects + OKRs + Decisions** — Full organizational layer. AgentOS had none.

4. **Notifications/Inbox** — 9 notification types (mention, alert, briefing, completion, failure, dispatch, queue, budget, a2a) with read/archive lifecycle.

5. **Process Capture via Claude Code Hooks** — Real-time tool-level visibility into what agents are doing. AgentOS had nothing comparable (tmux scraping at best).

6. **Review Policy System** — 5-level configurable review strictness (strict/normal/lax/autonomous/peer-review) with per-task, per-project, per-role precedence.

7. **Kill Switch** — Global emergency pause that suspends all active sessions and persists across restarts. AgentOS had no equivalent.

8. **Circuit Breakers** — Per-issue failure tracking with exponential backoff. Prevents infinite retry loops that could burn budget.

9. **Standing Duties Engine** — Proactive behaviors driven by YAML config. Cron-based (e.g., pulse check every 2h) and event-triggered (e.g., postmortem on failure). Zero code changes to add new behaviors.

10. **Discord Bidirectional Bridge** — Full Discord bot with per-agent identity (webhooks with custom avatars). AgentOS had no Discord integration.

11. **Agent SDK** — Typed CLI (`anc comment`, `anc dispatch`, `anc handoff`, `anc ask`, `anc search`, `anc create-sub`) that agents use to interact with Linear and each other. AgentOS agents had no structured SDK.

12. **WebSocket Real-time Dashboard** — Live event streaming to web clients. Initial state snapshot + incremental updates.

13. **Detailed Health Endpoint** — Component-level health reporting (database, Linear API, queue, sessions, circuit breakers, webhooks) with latency metrics.

14. **Budget Config API** — CRUD API for budget limits with daily and per-agent granularity, alert thresholds, and 7-day history.

15. **Smart Session Eviction** — 3-tier eviction: idle+processed > idle+oldest > active+low-priority. CEO-assigned sessions are never auto-evicted.

## Architecture Differences

| Aspect | AgentOS | ANC | Better |
|---|---|---|---|
| **Event handling** | Monolithic `serve.ts` (570 lines) with inline handlers | Typed event bus + 10 separate handler files | ANC |
| **Execution model** | SSH to remote iMac, all tmux remote | Local tmux (designed for single-machine) | Depends on use case |
| **Config format** | JSON files in `~/.aos/` | YAML files in `config/` directory | ANC (YAML more readable) |
| **Linear API** | Direct SDK calls + raw GraphQL | SDK calls + rate limiter + retry logic | ANC |
| **Webhook security** | No signature verification | HMAC signature verification | ANC |
| **Session lifecycle** | 2 states (active/completed) | 3 states (active/idle/suspended) with transitions | ANC |
| **Database schema** | 2 tables, no migrations | 16 tables, multiple migration paths | ANC |
| **Agent identity** | OAuth + AgentSession API (unreliable) | OAuth + comment-based (reliable) | ANC |
| **Persona system** | Monolithic CLAUDE.md per agent | Composable fragments (base + role + protocols) | ANC |
| **Queue** | In-memory with SQLite backup | SQLite-first with in-memory cooldowns | ANC |
| **Error handling** | Crashes on uncaught exceptions | Global error handlers, continues running | ANC |

## Recommended Priority Order

Top 10 items to close, ranked by CEO impact:

1. **Add BLOCKED.md detection** (1h) — Distinguish "agent is stuck" from "agent finished." Currently both are "idle."
2. **A2A messaging** (planned, not yet built) — The data model supports it (task_comments table), but no runtime wiring for agent-to-agent real-time communication.
3. **Linear webhook for issue.updated** — ANC classifies it but the handlers don't act on status changes from the Linear side. If someone manually moves an issue in Linear, ANC won't react.
4. **Cost tracking accuracy** — Hook-based transcript parsing is good but the fallback `estimateCostFromElapsed()` ($0.10/min) is rough. Consider making transcript parsing the only path and alerting when it fails.
5. **Test coverage** — AgentOS had test files (`budget.test.ts`, `config.test.ts`, `db.test.ts`, `linear.test.ts`, `persona.test.ts`, `queue.test.ts`, `router.test.ts`, `integration.test.ts`). ANC has vitest configured but test files were not found in src/.
6. **Session timeout** — Neither system has a hard timeout for runaway sessions. An agent that loops forever consumes a slot indefinitely. Add a configurable max session duration.
7. **Multi-model adapter** — If Gemini or other models become viable, extract the spawn logic into a pluggable adapter.
8. **GitHub webhook integration** — Neither system reacts to GitHub events (PR merged, CI failed, etc.). Would improve the feedback loop for code tasks.
9. **Structured logging** — ANC has `createLogger()` but logs go to stdout only. Consider structured JSON logging for easier debugging in production.
10. **DB backup to remote** — ANC backs up locally. Consider backing up to the iMac or cloud for disaster recovery.
