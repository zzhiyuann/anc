# Error Handling Spec

> ANC error handling strategy: classification, logging, alerting, and recovery.

## Error Categories

### Fatal (process must restart)

| Error | Source | Why Fatal |
|-------|--------|-----------|
| DB directory not writable | `db.ts` getDb() | All state persistence broken — no sessions, no events |
| SQLite open/migration failure | `db.ts` getDb() | Same as above |
| tmux not found | `runner.ts` getTmuxPath() | Cannot spawn or manage any agent sessions |
| Port already in use | `gateway.ts` server.listen() | Gateway cannot receive webhooks |
| Linear API key missing/invalid | `client.ts` initial auth | All issue operations fail — orchestration impossible |

**Recovery**: Log error, post to Discord/Telegram if possible, exit with non-zero code. Supervisor (systemd/launchd) restarts the process.

### Retryable (exponential backoff)

| Error | Source | Strategy |
|-------|--------|----------|
| Linear API 429 (rate limit) | `rate-limiter.ts` | Drain bucket, backoff `BASE * 2^attempt`, cap 30s, max 3 retries |
| Linear API 5xx | `client.ts` | Same backoff as 429 — server-side transient |
| Discord API rate limit | `discord.ts` | Backoff, cap 10s, max 2 retries |
| tmux spawn failure | `runner.ts` spawnClaude() | Circuit breaker: 3 failures → exponential cooldown (60s, 120s, 240s, cap 30min) |
| Webhook signature verify fail | `gateway.ts` | No retry (caller's problem), return 401 |

### Degraded (log + continue)

| Error | Source | Behavior |
|-------|--------|----------|
| Discord message post fails | `discord.ts` | Log warn, continue — notifications are best-effort |
| Linear comment post fails | `on-lifecycle.ts` | Log warn, continue — comments are informational |
| Linear AgentSession dismiss fails | `on-lifecycle.ts` | Log debug, continue — badge is cosmetic |
| File logging write fails | `logger.ts` | Silent continue — console output still works |
| tmux kill/send fails | `runner.ts` | Return false, continue — session may already be dead |
| DB backup fails | `db.ts` | Log warn, continue — primary DB still intact |
| Memory file validation fails | `on-complete.ts` | Log warn, continue — memory is optional |

### Silent (intentionally swallowed)

| Error | Source | Rationale |
|-------|--------|-----------|
| Stale tmux session kill during spawn | `runner.ts:105` | Best-effort cleanup before fresh spawn |
| Emoji reaction add fails | `discord.ts` | Cosmetic; not worth logging |
| Role mapping fetch in Discord | `discord.ts` | Falls back to bot default avatar |

## Logging Strategy

### Levels

| Level | When | Examples |
|-------|------|---------|
| `error` | Something failed that should have succeeded; needs investigation | DB write failure, unhandled exception, spawn crash |
| `warn` | Degraded operation; system compensated but behavior is suboptimal | API query returned empty (possible outage), retry exhausted, rate limit hit |
| `info` | Normal operational events | Agent spawned, issue dispatched, server started |
| `debug` | Diagnostic detail for troubleshooting | Backoff delay values, session state transitions, GraphQL response bodies |

### Format

All log lines follow: `[LEVEL] [timestamp] [component] message`

Components: `gateway`, `bus`, `runner`, `resolve`, `linear`, `discord`, `lifecycle`, `tick`, `complete`, `db`

### What to log on error

Every error log MUST include:
1. **What failed** — the operation name (e.g., "addComment", "spawnClaude")
2. **Error message** — `(err as Error).message`
3. **Context** — issue key, session ID, or agent role when available

Anti-pattern: `catch { }` with no logging (currently ~15 sites in codebase).

## Alerting Strategy

### Tier 1: Immediate (Discord + Telegram)

| Trigger | Channel | Why |
|---------|---------|-----|
| Process crash / uncaught exception | Both | Complete outage |
| Circuit breaker tripped (3+ spawn failures) | Discord | Agent fleet degraded |
| Linear API auth failure (401/403) | Telegram | All operations will fail |
| Gateway cannot bind port | Telegram | No webhooks = no events |

### Tier 2: Digest (Discord only, batched per tick)

| Trigger | Threshold | Why |
|---------|-----------|-----|
| Rate limit retries exhausted | 3+ in one tick cycle | API pressure; may need to reduce concurrency |
| Query failures returning empty | 5+ consecutive | Possible API outage |
| Discord post failures | 3+ consecutive | Discord integration down |

### Tier 3: Log only (no alert)

Everything in the "Degraded" and "Silent" categories above. Visible in log files for post-incident analysis.

## Current Gaps and Fixes

### Critical (should fix now)

1. **Unprotected file I/O in gateway** (`gateway.ts` asset/docs endpoints) — `readFileSync` can throw ENOENT and crash the HTTP handler. Wrap in try/catch, return 404/500.

2. **Sub-issue creation not wrapped** (`on-complete.ts:186`) — `createSubIssue()` call inside `processHandoff()` is unprotected. If Linear API fails, the entire completion handler crashes. Wrap in try/catch with error logging.

3. **DB init unprotected** (`db.ts:30`) — `mkdirSync` can throw on permission errors. Wrap in try/catch that throws a descriptive fatal error.

4. **Global exception handler doesn't exit** (`index.ts:111-117`) — `uncaughtException` logs but keeps running. After an uncaught exception, process state is undefined. Should log, attempt Discord/Telegram alert, then `process.exit(1)` after a short drain period.

### Medium (should fix soon)

5. **Query failures return empty arrays** (`client.ts` lines 329, 358, 385) — API outages become invisible. Add `log.warn` before returning `[]`.

6. **Bus handler errors not surfaced** (`bus.ts:31-39`) — Consider emitting a `bus:handler-error` event or incrementing a counter for health checks.

7. **CLI async commands unwrapped** (`index.ts` company start, agent commands) — Unhandled rejections crash CLI. Wrap in try/catch with user-facing error message.

### Low (nice to have)

8. **Discord failure monitoring** — Track consecutive Discord failures; alert after threshold.

9. **Structured error types** — Create `FatalError`, `RetryableError`, `DegradedError` classes so catch blocks can route errors by type rather than guessing.

## Design Principles

1. **Fail loudly for data integrity, silently for cosmetics.** DB writes and session state must error visibly. Discord reactions and comment badges can fail quietly.

2. **Retry only what's retryable.** 429s and 5xxs get backoff. 4xxs (except 429) are caller bugs — fail immediately.

3. **Circuit breakers protect the fleet.** One broken issue shouldn't consume all spawn capacity. The existing circuit breaker in `resolve.ts` is correct; extend the pattern to Linear API calls if 5xx errors become persistent.

4. **Alerts match urgency.** Process death = immediate Telegram ping. Rate limit pressure = Discord digest. Comment failure = log file only.

5. **Never swallow errors in critical paths.** The event bus, session resolution, and completion detection are critical paths. Every catch block in these paths must log at `warn` or above.
