# Completion Protocol

When your work reaches a decision point, write `HANDOFF.md` with a **Summary** and an **Actions** block.

## When to Write HANDOFF.md
- You completed the task → write summary + `status: Done` or `In Review`
- You need someone else to continue → write summary + dispatches
- Conversations / quick answers → NO HANDOFF needed, just answer and exit

## HANDOFF.md Format

```markdown
# HANDOFF — <issue-key>: <title>

## Summary
<What you did, what was produced, any concerns>

## Verification
<How to verify your work>

## Actions
status: <Done | In Review | In Progress>
dispatches:
  - role: <engineer | strategist | ops>
    context: "<what they should do>"
  - role: <role>
    new_issue: "<title for sub-issue>"
    context: "<what they should do>"
delegate: <role or omit>
parent_status: <Done | In Review | In Progress or omit>
```

## Choosing Status

**`Done`** — You finished everything. No review needed. Use for: trivial fixes, test results, routine tasks.

**`In Review`** — You finished but CEO should review before closing. Use for: features, strategy docs, anything with judgment calls.

**`In Progress`** — You did your part but work continues via dispatches. The issue stays open. Use for: handoffs, decomposition, multi-phase work.

## Dispatch Patterns

**No dispatches** (most common) — You did all the work:
```
## Actions
status: In Review
```

**Handoff to one person** — You're done, they continue:
```
## Actions
status: In Progress
dispatches:
  - role: strategist
    context: "Review the technical analysis and add market positioning"
delegate: strategist
```

**Decompose into sub-tasks** — Create parallel sub-issues:
```
## Actions
status: In Progress
dispatches:
  - role: engineer
    new_issue: "Implement API endpoint"
    context: "Build the REST endpoint per the spec in this issue"
  - role: strategist
    new_issue: "Write launch announcement"
    context: "Draft announcement based on the feature we're building"
```

**Last sub-task completing** — Update parent:
```
## Actions
status: Done
parent_status: In Review
```

## Dispatch Patterns

**One issue = one agent.** Every dispatch creates a sub-issue. Context passes through the sub-issue description.

**Sequential handoff** — you did phase 1, someone else does phase 2:
```
## Actions
status: In Review
dispatches:
  - role: strategist
    new_issue: "Phase 2: Add market positioning to tutorial"
    context: "I wrote the technical tutorial at docs/tutorial.md. Add positioning, use cases, and polish for public audience."
```

**Parallel decomposition** — split into independent tracks:
```
## Actions
status: In Progress
dispatches:
  - role: engineer
    new_issue: "Run test suite for v1.0"
    context: "Verify all 127 tests pass, fix any failures"
  - role: strategist
    new_issue: "Write release announcement"
    context: "Draft announcement based on changelog"
  - role: ops
    new_issue: "Verify service health"
    context: "Run health checks on webhook, tunnel, database"
```

**Deep nesting** — sub-issues can create their own sub-issues:
There is no depth limit. Each sub-issue agent can decompose further.
Parent stays In Progress until children complete.

**Last piece completing** — update parent:
```
## Actions
status: Done
parent_status: In Review
```

## Rules
- **You decide** the status. The system executes your decision.
- **Dispatches are guaranteed** — the system creates issues and spawns agents.
- **No dispatch = no handoff** — just set status and you're done.
- **Never set status to Backlog** — Backlog is CEO-only. Use Todo, In Progress, In Review, or Done.
- **Always include Actions block** — even if it's just `status: Done`.
