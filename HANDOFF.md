# Handoff: ANC — Agent Native Company

## Objective
Build ANC as a production-ready replacement for AgentOS. Linear-native agent orchestration with 3 agents (Engineer, Strategist, Ops), event-driven architecture, per-issue workspace isolation, and agent-decided structured completions.

## Current status

**Done:**
- Full event bus architecture (typed EventEmitter, concurrent handlers)
- Webhook gateway receiving Linear events at `ryanwang.cc/anc/webhook`
- 3-agent roster with OAuth tokens (app:assignable scope)
- Declarative YAML routing (label/project/title/assignee rules)
- Priority queue with dedup
- Per-issue workspace isolation (git worktree support)
- Hybrid session model (claude -p first run, --continue for follow-ups)
- 3-state lifecycle: active/idle/suspended
- Structured HANDOFF.md Actions block (agent decides status, dispatches, parent_status)
- All dispatches create sub-issues (one issue = one agent)
- Circuit breaker (3 fails → exponential backoff)
- Proactive duties engine (company pulse, failure post-mortem)
- Dual capacity pools (5 task + 1 duty per role)
- Agent SDK CLI (`anc comment/dispatch/handoff/ask/search/reply/list-issues`)
- Discord bidirectional + Telegram outbound
- Lifecycle comments on Linear (picked up, failed, suspended, resumed)
- Status transitions: Todo → In Progress (agent) → In Review/Done (agent-decided)
- Filename escaping in comments (prevents Linear auto-linking .md as URLs)
- Startup recovery from existing tmux sessions
- SQLite persistence + graceful shutdown
- CEO Guide at docs/CEO-GUIDE.md
- Roadmap at docs/ROADMAP.md
- 127 tests passing

**Partially done:**
- AgentSession "Working..." badge — API works (`agentSessionCreateOnIssue` tested successfully) but setting `delegateId` auto-creates sessions that timeout as "Did not respond". Currently delegateId is disabled to avoid this bug. Needs proper session lifecycle management.
- Agent-to-agent chain handoffs — Actions block dispatches work, sub-issues created correctly with Todo state, but deep chains not fully tested end-to-end.

**Not done:**
- Structured logging (still console.log in some paths)
- Integration test suite
- Company mode (start/stop all agents)
- Cost tracking
- Performance metrics
- LaunchAgent plist for daemon mode

## Key decisions
- **No delegateId** — setting it triggers auto-created AgentSession that shows "Did not respond". Removed entirely. Agent identity shown through comments + status changes instead.
- **No explicit createAgentSession** — same problem. Linear creates sessions from delegateId which we can't reliably dismiss in time.
- **One issue = one agent** — all dispatches create sub-issues. No same-issue chain dispatch.
- **HANDOFF.md optional** — agent writes it for formal work (triggers quality gates), skips for conversations. System falls back to old behavior if no Actions block.
- **Linear MCP blocked** — agents must use `anc` CLI (prevents identity leak via CEO's global MCP token).
- **AgentOS fully killed** — serve unloaded, pulse unloaded, all tmux killed. Only tunnel remains.

## Important context
- ANC team in Linear: `570e7df2-77ba-4985-843b-5b7718eb7618`, key `ANC`
- Webhook: `https://ryanwang.cc/anc/webhook` via cloudflared named tunnel (config at `~/.cloudflared/config.yml`, path `/anc.*` → localhost:3849)
- OAuth tokens at `~/.anc/agents/{engineer,strategist,ops}/.oauth-token` with scope `read,write,issues:create,comments:create,app:assignable`
- Agent Linear user IDs: Engineer=`0000aa44-...`, Strategist=`b7171924-...`, Ops=`1f4d2ee9-...`
- AgentOS is DEAD (serve + pulse LaunchAgents unloaded). Tunnel still running (harmless).
- Linear API rate limit: 5000/hour. Rate limiter at `src/linear/rate-limiter.ts`.

## Files to read first
1. `src/hooks/on-complete.ts` — HANDOFF detection + Actions parser + dispatch execution (the core completion flow)
2. `src/runtime/runner.ts` — resolveSession gate + spawn + setIssueInProgress
3. `src/hooks/on-lifecycle.ts` — lifecycle comments + AgentSession dismiss logic
4. `src/hooks/actions-parser.ts` — parses ## Actions block from HANDOFF.md
5. `src/runtime/health.ts` — 3-state session lifecycle (active/idle/suspended)
6. `config/agents.yaml` — agent roster with maxConcurrency + linearUserId
7. `config/routing.yaml` — declarative routing rules
8. `personas/protocols/completion.md` — HANDOFF.md template agents follow
9. `docs/CEO-GUIDE.md` — how CEO creates/manages issues
10. `docs/ROADMAP.md` — Phase A-E evolution plan

## Commands / checks
```bash
cd /Users/zwang/projects/anc
npm run build                    # should compile clean
npx vitest run                   # 127 tests should pass
export $(cat .env | grep -v '^#' | grep -v '^$' | xargs)
node dist/index.js serve         # start ANC
curl http://localhost:3849/health # verify running
tmux list-sessions | grep anc    # check active agents
```

## Open problems

1. **"Working..." badge** — `agentSessionCreateOnIssue` API works (tested manually, session ID returned). But `delegateId` auto-creates ANOTHER session that times out. Need to either: (a) find how to create session WITHOUT delegateId triggering one, or (b) figure out the correct dismiss/acknowledge flow for the auto-created session. AgentOS solved this — check `src/core/linear-sessions.ts` in AgentOS for their approach. The key difference may be that AgentOS's OAuth apps were created with different settings.

2. **Sub-issues created in Backlog** — `createSubIssue` sets `stateId: todoStateId` and does follow-up `updateIssue`, but some sub-issues still land in Backlog. May be a timing issue or the state ID cache returning null.

3. **Agent tasks too large** — agents hit token limits on big tasks (write full tutorial). Need to either break prompts into smaller chunks or increase max output tokens.

4. **Linear API rate limit** — 5000 req/hour shared across ALL clients. Heavy debugging sessions exhaust it. Rate limiter added but conservative.

## Next best steps

1. **Fix "Working..." badge** — investigate AgentOS's `linear-sessions.ts` to understand how they manage AgentSessions without "Did not respond". This is the #1 UX gap.
2. **Test multi-agent chain** — create issue where Engineer → creates sub-issue for Strategist → creates sub-sub-issue for Ops. Verify the full tree builds correctly.
3. **Fix sub-issue Backlog bug** — add logging to `createSubIssue` to see what `getWorkflowStateId('Todo')` returns. May need to warm the state cache on startup.
4. **Phase B: Production hardening** — structured logging, error handling audit, integration tests. See `docs/ROADMAP.md`.

## Artifacts
- Git repo: `/Users/zwang/projects/anc/` (52 commits, 5903 LOC src, 1386 LOC tests)
- GitHub: `https://github.com/zzhiyuann/anc` (private)
- Linear project: "ANC System" with roadmap document
- `.env` at project root (API keys, tokens)
- Agent OAuth tokens at `~/.anc/agents/*/`
- State DB at `~/.anc/state.db` (SQLite, disposable)
- Workspaces at `~/anc-workspaces/` (per-issue directories)

## Notes for next agent
- **Always `unset CLAUDE_CODE CLAUDECODE` in spawn scripts** — nesting detection kills agent sessions silently
- **Never set `delegateId` on issues** — triggers "Did not respond" AgentSession bug
- **Kill AgentOS before testing** — `launchctl unload com.agentos.serve.plist` + `com.agentos.pulse.plist`. CTO/COO from AgentOS will pick up ANC issues otherwise.
- **Rate limit resets hourly** — if API calls start failing, wait or check `curl -s http://localhost:3849/health` for rate limit status
- **`tmux kill-server` kills EVERYTHING** — including active agent sessions. Use `tmux kill-session -t <name>` instead.
- **Test with small tasks first** — "add one field to health endpoint" works. "Write a full tutorial" exceeds token budget.
