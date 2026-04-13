# Eval Harness ↔ ANC Integration Issues

**Context**: The research eval harness (`research/eval/`) needs to programmatically create tasks, dispatch agents, and detect completion via the ANC REST API. Several integration gaps prevent automated ablation experiments from running end-to-end.

## Issue 1: REST-created tasks don't auto-route

**Observed**: Tasks created via `POST /api/v1/tasks` stay in `todo` state. ANC does not auto-dispatch them to agents.

**Expected**: Tasks created via API should go through the same routing pipeline as webhook-created tasks (YAML rules → agent match → dispatch).

**Workaround attempted**: Manually calling `POST /tasks/:id/dispatch` with `{"role": "engineer"}` after creation. This works — agent spawns.

**Fix needed**: Either auto-route API-created tasks, or document that `/dispatch` is required. Ideally `POST /tasks` accepts an optional `autoRoute: true` flag.

## Issue 2: Task state doesn't update to `in_progress`

**Observed**: After dispatch, task state stays `todo` even though the agent is actively working in tmux. It never transitions to `in_progress`.

**Expected**: State should go `todo → in_progress` when the agent session spawns, then `in_progress → review/done` on completion.

**Impact**: Polling `GET /tasks/:id` for `state === 'done'` never triggers because the state machine doesn't advance.

**Fix needed**: The dispatch handler or session lifecycle should update task state to `in_progress` when an agent starts working on it.

## Issue 3: Completion detection is unreliable

**Observed**: When the agent finishes (tmux session exits), the task state doesn't reliably update to `done` or `review`. The HANDOFF.md detection → state update pipeline doesn't fire for API-created tasks.

**Strategies attempted in eval harness**:
1. Poll `GET /tasks/:id` for `state === 'done'` → never triggers (Issue 2)
2. Poll `GET /agents/engineer` for session `state === 'idle'` → sometimes works
3. Check `tmux has-session` for tmux death → works but can't retrieve output

**Fix needed**: Ensure the HANDOFF.md watcher and `on-completion` hook fire for all task types, not just Linear-webhook-originated tasks. Alternatively, expose a WebSocket event `task:completed` that the eval harness can listen to.

## Issue 4: No way to retrieve agent output post-completion

**Observed**: After agent completes, `GET /tasks/:id` returns `handoffSummary: null`. The actual HANDOFF.md content is in the workspace directory but not exposed via API.

**Expected**: `GET /tasks/:id` should include the HANDOFF.md content (or a summary) in the response after completion.

**Fix needed**: The completion hook should write HANDOFF.md content to the task record (`handoffSummary` field in the tasks table).

## Issue 5: tmux session cleanup

**Observed**: Engineer tmux sessions disappear after a few minutes even when the agent hasn't written a HANDOFF.md. Unclear if this is the health monitor cleaning up or Claude Code exiting.

**Expected**: Sessions should persist until explicitly cleaned up or until HANDOFF.md is detected.

## Summary of What Eval Harness Needs

The eval harness needs a simple contract:

```
1. POST /tasks  (create)           → returns { id }
2. POST /tasks/:id/dispatch        → returns { session }
3. Task state auto-advances:       todo → in_progress → done/review/failed
4. GET /tasks/:id                  → includes handoffSummary when done
5. WebSocket event on completion   → { taskId, state, handoffSummary }
```

Currently steps 3 and 4 don't work reliably for REST-API-created tasks. Once these are fixed, the eval harness (`research/eval/simceo.ts` `executeTask()` function) should work out of the box.

## Repro

```bash
# Start server
ANC_BUDGET_DISABLED=true npx tsx src/index.ts serve --port 3849

# Create task
curl -s -X POST http://localhost:3849/api/v1/tasks \
  -H 'Content-Type: application/json' \
  -d '{"title": "Fix typo in README", "description": "Change recieve to receive", "priority": 3}'
# Returns: {"id": "task-xxx"}

# Dispatch
curl -s -X POST http://localhost:3849/api/v1/tasks/task-xxx/dispatch \
  -H 'Content-Type: application/json' \
  -d '{"role": "engineer"}'
# Agent spawns in tmux ✓

# Poll — state never leaves "todo"
curl -s http://localhost:3849/api/v1/tasks/task-xxx
# {"state": "todo", "handoffSummary": null} ← even after agent finishes
```
