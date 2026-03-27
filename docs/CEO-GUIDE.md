# CEO Guide — Working with ANC

## Creating Issues

### Option A: Quick (label-based routing)
1. Create issue in Linear (ANC team)
2. Add a label → ANC auto-routes:
   - **Bug** or **Feature** → Engineer
   - **Plan** → Strategist
   - No label → Ops (triage)
3. Set to **Todo** → agent picks up within 30 seconds

### Option B: Direct (delegate to specific agent)
1. Create issue in Linear
2. Set **Assignee** to the agent you want: Engineer, Strategist, or Ops
3. Set to **Todo**
4. ANC sees the assignee and dispatches that agent

### Option C: Urgent
1. Create issue with **Priority: Urgent**
2. Add label (Bug/Feature/Plan)
3. Set to **Todo**
4. Agent picks up immediately (urgent = top of queue)

## What You Set

| Field | What to set | Required? |
|---|---|---|
| **Title** | Clear, descriptive | Yes |
| **Description** | Context, acceptance criteria, links | Yes |
| **Status** | Todo (agent picks up) or Backlog (parking) | Yes |
| **Label** | Bug / Feature / Plan (for routing) | Recommended |
| **Priority** | Urgent / High / Normal / Low | Recommended |
| **Assignee** | Engineer / Strategist / Ops (for direct assignment) | Optional |

## What ANC Handles Automatically

- **Status → In Progress**: when agent starts working
- **Delegate**: agent's name shows on the issue
- **Working... badge**: animated indicator while agent is active
- **Comments**: agent posts progress and completion summary
- **Status → In Review or Done**: agent decides based on work type
- **Sub-issues**: agent creates them if decomposition needed
- **Cross-agent dispatch**: agent hands off to other agents via Actions block

## Interacting with Agents

### Comment on an issue
Just write a comment. ANC routes it to:
1. **@Engineer** / **@Strategist** / **@Ops** → that specific agent (highest priority)
2. Reply under an agent's comment → that agent responds
3. Issue has a delegate → delegate responds
4. No specific target → last agent who worked on it

### Self-notes (agent won't respond)
Prefix with `self:` — agent ignores it:
```
self: need to think about this more before deciding
```

### Follow-up on Done issues
Comment on a Done/In Review issue → agent answers in **conversation mode** (no HANDOFF needed, just answers your question).

## Status Flow

```
Backlog → Todo → In Progress → In Review → Done
                     ↓              ↑
                  (agent            |
                   works)     (CEO reviews)
                     ↓              |
                  sub-issues → In Review
```

- **Backlog**: parked, agents ignore
- **Todo**: agent will pick up
- **In Progress**: agent is working (Working... badge visible)
- **In Review**: agent finished, awaiting your review
- **Done**: completed (agent auto-closes trivial tasks, or you close after review)

## Reviewing Work

1. Go to **In Review** issues
2. Read the agent's HANDOFF summary (posted as comment)
3. If satisfied → move to **Done**
4. If needs changes → comment with feedback (agent resumes work)

## Discord

Agents post to Discord:
- Completion summaries with ✅ emoji
- Failure alerts with ❌ emoji
- Company pulse reports (every 2 hours)

You can @mention agents in Discord too:
```
@engineer what's the status of ANC-30?
```
