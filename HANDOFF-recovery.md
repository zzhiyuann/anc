# HANDOFF — ANC Recovery: Roll Back to Working Dispatch

## Context

Session `a73f0159` rebuilt ANC from scratch (replacing AgentOS). By commit `4081630` (2026-03-27 00:47), everything was working — "all wins" confirmed by user. Then a cascade of changes broke the system beyond repair within the same session.

## The Good State: `9913109` (01:03)

At this commit, dispatch had **two working paths**:

1. **Sub-issue dispatch** (via `new_issue` in Actions block) — creates child issue, sets delegate, spawns agent. Already working correctly.
2. **Same-issue chain dispatch** (no `new_issue`) — passes baton to another agent on the same issue. Also working (Engineer → Strategist tested).

Key files at this state:
- `src/hooks/on-complete.ts` — dual-path dispatch logic (sub-issue OR same-issue)
- `personas/protocols/completion.md` — agent protocol with both Chain and Decompose patterns
- `src/hooks/on-lifecycle.ts` — lifecycle comments + AgentSession handling (working)
- `src/hooks/on-session.ts` — session management (working)

What was working:
- 3 agents (Engineer, Strategist, Ops) all dispatching correctly
- Sub-issues created via Actions block `new_issue` field
- Chain dispatch on same issue via Actions block without `new_issue`
- "Working..." badge via AgentSession API
- `delegateId` being set correctly
- Linear status transitions (Todo → In Progress → In Review/Done)
- Quality gates on HANDOFF.md
- 127 tests passing

## The Inflection Point: `382268c` (01:06)

User correctly pointed out: dispatches should ALL create sub-issues (one issue = one agent). Commit `382268c` enforced this by removing the same-issue chain path.

**This commit only changed 2 files:**
- `src/hooks/on-complete.ts` — removed same-issue dispatch, forced all dispatches through `createSubIssue`
- `personas/protocols/completion.md` — updated protocol docs

But it triggered a cascade of AgentSession/delegate bugs (agents showing "Did not respond", orphaned "Working..." badges).

## The Cascade of Failed Fixes (01:06 → 01:47)

| Commit | What it did | Effect |
|--------|-------------|--------|
| `382268c` | Force all dispatches to create sub-issues | Broke AgentSession lifecycle |
| `9dcaaf8` | Dismiss ALL AgentSessions on completion | Orphaned badges |
| `d938fb7` | Remove `createAgentSession` entirely | Made things worse |
| `4ff65dc` | Acknowledge auto-created AgentSessions | Didn't fix "Did not respond" |
| `3bb0813` | Dismiss AgentSession immediately after delegate | Still broken |
| `0050167` | **Remove `delegateId` entirely** | Nuclear option — "Working..." badge gone |
| `b869441` | Session handoff written (current HEAD) | Gave up |

Interleaved with these are several unrelated doc/health-endpoint commits from a parallel agent.

## Recovery Plan

### Option A: Rollback to `9913109` (recommended)

```bash
cd /Users/zwang/projects/anc
git reset --soft 9913109
git stash  # save the diff for cherry-picking docs later
```

Then carefully re-apply ONLY the "force sub-issue" logic:
- In `on-complete.ts`: remove the `if (!dispatch.newIssue)` same-issue path
- Auto-generate `new_issue` title if agent omits it: `"${dispatch.role}: ${parentKey} follow-up"`
- Do NOT touch `on-lifecycle.ts`, `on-session.ts`, `runner.ts`, or anything AgentSession-related

### Option B: Rollback to `4081630` (safest)

This is the "all wins" state before chain dispatch was even tested. Sub-issues already work via `new_issue` in Actions. Same-issue chain also works but hasn't been stress-tested.

```bash
git reset --soft 4081630
```

### What to keep from the cascade

Some commits after `382268c` contain useful non-breaking changes:
- `docs/getting-started.md` — tutorial (from `472aef0`, `e94d1f0`)
- `docs/onboarding.md` — onboarding guide (from `b1096f4`)
- `docs/error-handling-spec.md` — error spec (from `c62a7ae`)
- `src/gateway.ts` health endpoint improvements (various)
- `README.md` fixes

These can be cherry-picked after rollback.

## Key Architecture Facts

- **Repo**: `/Users/zwang/projects/anc/`
- **Linear team**: `570e7df2-77ba-4985-843b-5b7718eb7618`, key `ANC`
- **Webhook**: `ryanwang.cc/anc/webhook` → `localhost:3849`
- **OAuth tokens**: `~/.anc/agents/{engineer,strategist,ops}/.oauth-token`
- **Agent IDs**: Engineer=`0000aa44-...`, Strategist=`b7171924-...`, Ops=`1f4d2ee9-...`
- **AgentOS**: DEAD (unloaded), only tunnel remains

## The Core Lesson

The "one issue = one agent" rule is correct as a design principle. The implementation at `382268c` was conceptually right but disrupted the AgentSession lifecycle. The fix is to apply the same `on-complete.ts` change on top of the working `9913109` base WITHOUT touching any AgentSession/delegate code. The `delegateId` and `createAgentSession` were working fine at `9913109` — they should not have been changed.

## Files to Read First

1. `git show 9913109:src/hooks/on-complete.ts` — the working dispatch logic (dual-path)
2. `git show 9913109:src/hooks/on-lifecycle.ts` — the working AgentSession handling
3. `git show 382268c:src/hooks/on-complete.ts` — the sub-issue enforcement (keep concept, not impl)
4. `personas/protocols/completion.md` — agent protocol (at `9913109`)

## Commands

```bash
cd /Users/zwang/projects/anc
npm run build
npx vitest run                    # 127 tests should pass at 9913109
export $(cat .env | grep -v '^#' | grep -v '^$' | xargs)
node dist/index.js serve
curl http://localhost:3849/health
```
