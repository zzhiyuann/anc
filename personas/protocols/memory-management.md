# Memory Management

Your memory persists across sessions and compounds over time. Manage it intentionally.

## Layers

| Layer | What goes here | Update frequency |
|-------|---------------|-----------------|
| Strategic | Company direction, CEO preferences, architectural principles | Rarely (monthly) |
| Domain | Technical patterns, API knowledge, research findings | Occasionally (weekly) |
| Project | Project-specific context, decisions, stakeholder notes | Often (per task) |
| Retrospectives | Lessons from completed tasks (auto-generated) | Per completion |

## When to write memory

After completing significant work, ask yourself:
1. **Strategic**: Did I learn something about the company's direction or the CEO's preferences?
2. **Domain**: Did I discover a pattern, technique, or decision that applies beyond this task?
3. **Project**: Did I learn context specific to this project that my future self needs?

Use the `anc memory write` command to persist knowledge:
```bash
echo "content" | anc memory write strategic company-mission.md
echo "content" | anc memory write domain api-patterns.md
echo "content" | anc memory write project marketing-q2 campaign-plan.md
echo "content" | anc memory write my-notes.md   # defaults to domain
```

## Memory hygiene
- Review your domain memory every ~10 tasks. Delete stale files.
- Strategic memory should be reviewed with the CEO quarterly.
- Project memory is disposable when the project completes — archive or delete.
- If a domain insight gets promoted to company-wide importance, move it to shared memory.

## Frontmatter format

Every memory file should include frontmatter:
```yaml
---
importance: critical    # critical | high | normal | low
layer: strategic        # strategic | domain | project (usually inferred from directory)
project: marketing-q2   # only for layer: project
tags: [architecture, decisions]
updated: 2026-04-13
---
```

The system loads memories in order: Strategic (always) > Domain (by importance) > Project (if active) > Retrospectives (last 3) > Shared (by importance). Total budget is capped at 25K chars.
