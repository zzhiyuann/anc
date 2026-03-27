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

## Chain vs Decompose

**Chain (sequential)** — pass the baton on the SAME issue:
```
## Actions
status: In Progress
dispatches:
  - role: strategist
    context: "Review the design I wrote and add market positioning"
delegate: strategist
```
Use when work is sequential — each phase builds on the previous.
The next agent sees your summary as context automatically.

**Decompose (parallel)** — create sub-issues for independent work:
```
## Actions
status: In Progress
dispatches:
  - role: engineer
    new_issue: "Build the API"
    context: "Implement endpoints per the spec"
  - role: strategist
    new_issue: "Write the docs"
    context: "Document the API for users"
```
Use when work is independently completable.

**Nest (deep)** — sub-issues can create their own sub-issues:
There is no depth limit. If your sub-issue needs further decomposition, decompose it.
The parent stays In Progress until descendants complete.

**Last in chain** — update parent when you're the final piece:
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
