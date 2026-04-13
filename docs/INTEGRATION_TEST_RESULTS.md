# Integration Test Results — 2026-04-13

**Backend**: localhost:3849 | ANC_BUDGET_DISABLED=true

## Results: 6.5/8 passed

| # | Scenario | Result | Evidence |
|---|----------|--------|----------|
| 1 | Full task lifecycle | **PASS** | State=review, HANDOFF.md with Summary+Verification, quality-score=100, poem.md exists, 1 agent comment, cost=$0.22 |
| 2 | Model routing | **PASS** | P5/ops=haiku-3, P3/engineer=sonnet-4, P1/engineer=opus-4 — all correct |
| 3 | Follow-up conversation | **PASS** | CEO comment delivered via tmux, agent added haiku to poem.md, new comment posted |
| 4 | @mention dispatch | **PASS** | Strategist session spawned, task:dispatched event exists, 2 sessions in sessions array |
| 5 | Memory cross-agent search | **PARTIAL** | Write OK, delete OK, but search returns "Unknown agent role" — route `/memory/:role` at line 1050 shadows `/memory/search` at line 1642 |
| 6 | Parent-child feedback | **FAIL** | POST /tasks does not pass `parentTaskId` from request body to createTask() — child created without parent link, so no feedback loop triggered |
| 7 | Budget + cost endpoints | **PARTIAL** | Budget (200), Budget/series (200), Labels (200), Pulse/briefing (200), Kill-switch (200). Memory/health returns 404 (same `/memory/:role` shadow bug). Metrics endpoint does not exist (404). |
| 8 | Review policy | **PASS** | GET/PATCH/reset all return 200 with correct JSON. PATCH persisted engineer=strict, reset restored to normal. |

## Bugs Found

1. **Route shadowing** (medium): `/memory/:role` (line 1050) matches before `/memory/search` (line 1642) and `/memory/health` (line 1658). Any `/memory/<keyword>` path is intercepted as a role lookup. Fix: move exact `/memory/search` and `/memory/health` routes before the parameterized `/memory/:role`.

2. **parentTaskId not passed** (medium): `POST /api/v1/tasks` handler (line ~390) does not forward `parentTaskId` from the request body to `createTask()`. The field exists in the DB schema but is unreachable from the API.

3. **Metrics endpoint missing** (low): `/api/v1/metrics` returns 404. Either not implemented or named differently.

## Cleanup

All 6 test tasks deleted. All 7 test tmux sessions killed. Memory test file deleted. Pre-existing sessions untouched.
