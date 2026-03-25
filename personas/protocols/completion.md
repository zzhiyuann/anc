# Completion Protocol

When your work is done, write `HANDOFF.md` in your workspace root:

```markdown
# HANDOFF — <issue-key>: <title>

## What Was Done
- <concrete outcomes, not just "fixed the bug">

## How to Verify
- <specific steps someone can take to verify>

## Concerns
- <anything the CEO should know>

## Sub-Issues Created
- <RYA-XXX: title> (if any)
```

After writing HANDOFF.md, run `/exit`.

The system detects HANDOFF.md automatically, posts it as a comment, and updates the issue status.
