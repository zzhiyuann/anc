# Status Reporting Protocol

You are responsible for keeping your task's status current in the ANC dashboard.
The dashboard cannot infer your status reliably from tmux state alone — it
depends on you to report transitions explicitly.

## When to report

Call `anc task status <taskId> <state>` at every lifecycle transition:

| Trigger                              | Command                                                        |
|--------------------------------------|----------------------------------------------------------------|
| You start work on a task             | `anc task status $ANC_TASK_ID running`                         |
| You publish HANDOFF.md (delivery)    | `anc task status $ANC_TASK_ID review --note "handoff posted"`  |
| Configured policy auto-advances      | (the gateway will move review → done; you do nothing)          |
| You hit an unrecoverable error       | `anc task status $ANC_TASK_ID failed --note "<reason>"`        |
| You voluntarily suspend / await reply| `anc task status $ANC_TASK_ID suspended --note "<reason>"`     |

The task id is exposed in your environment as `ANC_TASK_ID`.

## Review vs. done

Whether your `review` request auto-advances to `done` is governed by the
project's review-strictness policy (`config/review.yaml`). You do not need to
know the policy — always report `review` after a handoff. The gateway will
either leave it for human review or advance it for you, per policy.

## Communication Protocol

The dashboard shows your comments to the CEO. Post brief updates so the CEO
never has to dig through HANDOFF.md manually.

### When you start working
Post a brief plan:
```bash
anc task comment $ANC_TASK_ID "Starting. Plan: <1-2 sentences>"
```

### After completing your task
1. Write HANDOFF.md with summary + actions
2. Post a brief completion comment:
```bash
anc task comment $ANC_TASK_ID "Done. <one-line summary of what you did>"
```

### If you encounter a blocker
1. Write BLOCKED.md explaining the issue
2. Post a comment:
```bash
anc task comment $ANC_TASK_ID "Blocked: <reason>. Need CEO input."
```

### If you are suspended
The system auto-posts a suspend comment. No action needed from you.

Note: The system also auto-posts lifecycle comments (start, complete, suspend,
error) on your behalf. Your manual comments add context the system cannot infer.

## Failure modes to avoid

- Do NOT report `done` directly. Always go through `review`.
- Do NOT silently exit your tmux session without reporting `failed` or `done`.
- Do NOT spam status updates — one transition per real lifecycle change.
- If `anc task status` returns a 409 (illegal transition), the task is already
  in a terminal state — stop trying and check the dashboard.
