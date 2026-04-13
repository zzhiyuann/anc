# Task Decomposition Protocol

## Two Modes of Decomposition

### Mode 1: Cross-role dispatch (use ANC sub-issues)
When a sub-task needs a **different specialist** than you:
- Strategist needs engineer to implement → `anc create-sub` + `anc handoff @engineer`
- Engineer needs ops to deploy → `anc create-sub` + `anc handoff @ops`
- Anyone needs strategist to research → `anc create-sub` + `anc handoff @strategist`

**Always use ANC dispatch for cross-role work.** This makes sub-tasks visible in the dashboard, trackable by the CEO, and enables the feedback loop (you get notified when the other agent finishes).

```bash
# Create a sub-task and hand it to another role
anc create-sub $ANC_TASK_ID "Implement pricing page HTML" "Build the HTML/CSS based on the research findings in pricing-research.md"
anc task comment $ANC_TASK_ID "@engineer please implement the pricing page based on my research"
```

### Mode 2: Same-role deep work (use Claude Code Agent Teams)
When you can handle all sub-tasks yourself because they're within your expertise:
- Strategist researching 3 competitors in parallel → use your internal agents
- Engineer refactoring 5 files → just do it sequentially or use internal agents
- Ops monitoring 3 services → use internal agents

**Use Claude Code's built-in agent/task tools for same-role parallelism.** This is faster and doesn't need dashboard visibility for each micro-step.

## Decision Framework

Ask yourself: **"Does this sub-task need someone with a different persona and memory?"**
- YES → `anc create-sub` + `anc handoff @role` (ANC dispatch)
- NO → Do it yourself, optionally with Claude Code Agent Teams

## When to Decompose at All

Decompose when:
- 3+ distinct deliverables
- Multiple independent concerns in the description
- Estimated effort > 2 hours
- **The task explicitly asks you to coordinate with other agents**
- You realize mid-task that another role would do a better job on a part

Do NOT decompose when:
- Single focused change (bug fix, config update)
- Sub-tasks would be < 10 minutes each
- Work is sequential with no parallelism benefit
- You're already a sub-task (avoid recursive decomposition)

## After Cross-Role Dispatch

1. Post a plan comment on the parent task: `anc task comment $ANC_TASK_ID "Plan: created N sub-tasks — [list them]"`
2. The system notifies you when each sub-task completes (feedback loop)
3. Once all cross-role sub-tasks are done, synthesize results
4. Write your HANDOFF.md for the parent task

## After Same-Role Deep Work

1. Just complete the work using your internal agents
2. Write HANDOFF.md when everything is done
3. Post a comment summarizing what you did: `anc task comment $ANC_TASK_ID "Done. [summary]"`
