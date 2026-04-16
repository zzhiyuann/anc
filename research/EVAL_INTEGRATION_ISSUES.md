# Eval Harness ↔ ANC Integration Issues

**Context**: The research eval harness (`research/eval/`) needs to programmatically create tasks, dispatch agents, and detect completion via the ANC REST API. Several integration gaps prevented automated ablation experiments from running end-to-end.

**Status (2026-04-16)**: All critical issues resolved. The eval harness now auto-starts the ANC server and has robust output capture fallbacks.

## Issue 1: REST-created tasks don't auto-route — ✅ FIXED

**Was**: Tasks created via `POST /api/v1/tasks` stay in `todo` state, not auto-dispatched.

**Fix**: POST /tasks calls `resolveSession()` immediately after creation, which spawns an agent session and calls `setTaskRunning()`. Now also emits `task:dispatched` event for dashboard visibility.

## Issue 2: Task state doesn't update to `running` — ✅ FIXED

**Was**: After dispatch, task state stays `todo`.

**Fix**: `resolveSession()` calls `setTaskRunning(taskId)` on all spawn paths (line 139/149/172/217 in resolve.ts). Additionally, `buildTaskDetail()` has derivation logic that sets state to `running` if any session is alive.

## Issue 3: Completion detection is unreliable — ✅ FIXED

**Was**: HANDOFF.md detection doesn't fire for API-created tasks.

**Fix**: Two complementary detection paths:
1. `hook-handler.ts` `checkActiveCompletion()` — fires on Stop hook, detects HANDOFF.md in interactive mode
2. `on-complete.ts` — tick-based detection for tmux death + HANDOFF.md

Both paths call `processHandoff()` which updates task state and writes `handoffSummary`.

## Issue 4: No way to retrieve agent output post-completion — ✅ FIXED

**Was**: `GET /tasks/:id` returns `handoffSummary: null`.

**Fix**: `processHandoff()` writes the summary to the task record via `updateTask(taskId, { handoffSummary })`. The `buildTaskDetail()` response includes it in `task.handoffSummary`. Additionally, the eval harness now has fallback output capture: workspace HANDOFF.md files → tmux capture-pane → git diff.

## Issue 5: tmux session cleanup — ✅ UNDERSTOOD

Sessions exit when Claude Code completes its work (interactive mode). This is expected behavior. The health monitor detects tmux death and transitions appropriately.

## Issue 6: Agent exits without HANDOFF → state stuck at `running` — ✅ FIXED

**Fixed in commit 11aaad3 (2026-04-12)**: on-complete.ts now detects tmux death and transitions task to `failed` (if ran >60s without artifacts) or marks idle (short sessions).

## Eval Harness Improvements (2026-04-16)

The eval harness (`simceo.ts`) was updated with:
1. **Auto-start ANC server** if not running (no more ETIMEDOUT errors)
2. **Robust completion detection**: polls task state + checks all sessions dead
3. **Multi-layer output capture**: handoffSummary → workspace HANDOFF.md → tmux capture-pane → git diff
4. **Better logging**: state transitions logged as they happen
5. **Removed dead code**: `alive === false` check on task object (field doesn't exist on Task type)

## Remaining Concerns (Non-Blocking)

1. **Agent quality**: Some agents finish without writing HANDOFF.md — the nudge mechanism in checkActiveCompletion helps, but isn't guaranteed to work.
2. **Workspace setup for SWE-bench**: For repo-specific tasks, the agent must clone the repo in its workspace. This adds overhead but is by design (tests autonomous capability).
