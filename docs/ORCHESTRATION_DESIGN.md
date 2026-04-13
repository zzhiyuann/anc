# ANC Orchestration System Design

> **Date**: 2026-04-13
> **Author**: System Architect (research session)
> **Status**: Draft for CEO review

## Executive Summary

1. **Solve interactive-mode exit** -- Agents in interactive tmux sessions finish work but never write HANDOFF.md or call `anc task status review`. Fix via Claude Code `Stop` hook that injects a completion-check prompt, plus a `TeammateIdle`-style heartbeat that detects idle agents. **Highest impact, lowest effort.**

2. **Adopt Claude Code Agent Teams as the native multi-agent backbone** -- Claude Code shipped Agent Teams (Feb 2026) with TaskCreate/TaskCompleted hooks, shared task lists, and inter-agent messaging. ANC should wrap this as a first-class dispatch mode alongside the existing tmux-spawn model. This is the single biggest architectural leap available.

3. **Build an event-driven feedback loop** -- When Agent B completes, Agent A must be notified. Implement via bus events (`task:completed` -> lookup parent session -> `sendToAgent()` with structured context). This closes the biggest gap vs CrewAI/AutoGen.

4. **Add Temporal-style checkpointing** -- PROGRESS.md is already partially implemented. Formalize it: agents must write PROGRESS.md every N minutes (enforced by a periodic `Stop` hook check), and the system auto-resumes from last checkpoint on crash.

5. **Implement quality gates as a pipeline** -- Self-verify -> peer review dispatch -> CEO approval. Configurable per task type and review policy. The building blocks exist (`core/review.ts`, quality checks in `on-complete.ts`); wire them into a proper pipeline.

---

## Problem Analysis

### Problem 1: Agent Doesn't Know When to Exit

**Root cause**: The completion protocol (`personas/protocols/completion.md`) tells agents to "write HANDOFF.md when done, then /exit." This works perfectly in `-p` (print) mode where claude exits automatically after responding. In interactive mode (`runner.ts:326` -- no `-p` flag), claude finishes its response and returns to the `>` prompt. The agent's LLM turn is over. It has no mechanism to self-trigger writing HANDOFF.md because **the agentic loop has stopped**.

**Where it breaks in code**:
- `runner.ts:_buildSpawnScript()` spawns claude in interactive mode (line 326)
- `on-complete.ts:110-133` only processes artifacts when tmux is dead (`alive` check at line 112)
- If tmux stays alive (interactive mode), the completion handler never fires
- The agent completed the task tokens ago but sits at `>` waiting for input

**Why HANDOFF alone isn't enough**: Even if the agent writes HANDOFF.md, the system won't detect it until tmux dies. In interactive mode, tmux stays alive indefinitely.

### Problem 2: Multi-Agent Dispatch + Collaboration

**Root cause**: The dispatch mechanism exists (`actions-parser.ts`, `on-complete.ts:293-332`) but only triggers **after** an agent writes HANDOFF.md with an `## Actions` block. There is no mechanism for an agent to spontaneously decide mid-task "this is too big, I should decompose it."

**Where it breaks in code**:
- `sdk.ts` has `createSubCommand()` and `handoffCommand()` but agents don't use them proactively
- The persona `base.md` says "Plan your approach before writing code" but doesn't say "If the task is large, decompose into sub-tasks before starting"
- No task complexity estimation exists -- a trivial fix and a 2-week feature get the same treatment
- `communication.md` lists `anc create-sub` and `anc dispatch` but provides no heuristics for when to use them

### Problem 3: Agent-to-Agent Feedback Loop

**Root cause**: Dispatch is fire-and-forget. `on-complete.ts:329` calls `resolveSession()` for each dispatch, creating child tasks. When those children complete, `on-complete.ts:389-403` sets the child task state but **never notifies the parent agent**.

**Where it breaks in code**:
- `on-complete.ts:399` emits `task:completed` on the bus
- No handler exists that maps `task:completed` -> "find parent task's session" -> "send message to parent agent"
- The parent agent's session may be idle or suspended by the time children finish
- Even if the parent is still active, it has no way to poll for child status

### Problem 4: Long-Running Reliability

**Root cause**: ANC spawns agents in tmux sessions with no timeout, no periodic checkpointing enforcement, and no context-window management. Claude Code sessions can hit the 200K token context limit and compact, losing working state.

**Where it breaks in code**:
- `runner.ts` has no max session duration
- `on-complete.ts:113-131` reads PROGRESS.md but only as a passive observer -- it doesn't enforce writing
- No crash recovery beyond `recoverSessionsFromTmux()` at startup (line 262)
- Context compaction loses the agent's working memory; no `PreCompact`/`PostCompact` hooks are configured
- Rate limit handling: if claude hits rate limits, the session stalls with no notification to ANC

### Problem 5: Quality Gates Before Delivery

**Root cause**: Quality gates exist but are minimal and only check the HANDOFF.md artifact, not the actual work product.

**Where it breaks in code**:
- `on-complete.ts:74-90` has `hasContent` (>50 chars) and `hasVerification` (regex for "pass"/"verified"/etc.)
- These check the HANDOFF text, not the code/deliverable
- `core/review.ts` defines review policies (strict/normal/lax/autonomous/peer-review) but they only affect whether the task goes to "In Review" vs "Done"
- No mechanism to dispatch a peer reviewer agent
- No mechanism to run tests/linting as a gate before status transition

---

## SOTA Survey

### CrewAI -- Role-Based Hierarchical Orchestration

**Architecture**: Four primitives (Agents, Tasks, Tools, Crew). Three process types: sequential, hierarchical, consensual. In hierarchical mode, a manager agent dynamically delegates tasks and tracks outcomes.

**Dispatch model**: `allow_delegation=True` on agents. Manager decides at runtime which specialist to invoke. CrewAI Flows (2025) add explicit DAG-based orchestration for production use.

**Feedback mechanism**: Task output from one agent feeds as context to the next (sequential) or returns to manager (hierarchical). Context is passed as structured `TaskOutput` objects.

**Failure handling**: Retry with backoff per task. Manager can reassign to a different agent. No durable checkpointing -- in-memory only.

**What ANC should steal**:
- **Complexity-based routing**: CrewAI's manager decides whether to handle a task itself or delegate. ANC agents should estimate task complexity (trivial/medium/complex) and only decompose for complex tasks. Add a complexity heuristic to `base.md` persona.
- **Structured task output types**: Instead of free-text HANDOFF.md, define typed deliverables per task type (code tasks produce diff + test results; research produces structured findings). Extend `HandoffActions` in `actions-parser.ts`.

### AutoGen (Microsoft) -- Multi-Agent Conversation Patterns

**Architecture**: Agents communicate through conversations. AutoGen 0.4 (Jan 2025) introduced modular components, custom memory, and diverse workflow patterns. Rebranded as Microsoft Agent Framework.

**Dispatch model**: Six patterns -- sequential, concurrent, group chat, handoffs, mixture of agents, multi-agent debate. Group chat uses a speaker-selection policy (round-robin, LLM-selected, or finite state machine graph).

**Feedback mechanism**: Conversation history is the feedback loop. Each agent sees all prior messages. Group chat enables real-time multi-agent discussion.

**Failure handling**: Conversation-level retry. No built-in durable execution.

**What ANC should steal**:
- **Finite state machine for task lifecycle**: AutoGen's FSM-based speaker transitions map well to ANC's task state machine (`tasks.ts:165-173`). Extend the state machine to include orchestration states: `planning` -> `decomposed` -> `executing` -> `integrating` -> `review`.
- **Group chat for design reviews**: When peer review is needed, spawn a "review group" where the author agent and reviewer agent discuss. The current `anc ask @<role>` is one-shot; make it conversational.

### LangGraph -- Stateful Workflows with Checkpointing

**Architecture**: Directed graph where nodes are functions, edges are conditional transitions. State is a typed dictionary that flows through the graph. Persistence via checkpointers (SQLite, Postgres, DynamoDB).

**Dispatch model**: Graph-based. Nodes can be agents. Conditional edges route based on state. Supports cycles (agent loops) and parallel branches.

**Feedback mechanism**: State accumulation -- each node reads and writes to shared state. Human-in-the-loop via `interrupt()` which pauses execution at any node, persists state, and resumes when the human responds.

**Failure handling**: **This is LangGraph's killer feature.** Checkpointing saves state after every node. On failure, resume from last successful checkpoint. Thread-based -- each execution has a thread ID, and you can rewind to any checkpoint.

**What ANC should steal**:
- **Per-step checkpointing**: ANC should save task state to SQLite after every significant agent action (not just PROGRESS.md). Add a `task_checkpoints` table: `{taskId, stepIndex, state, timestamp, context_summary}`. On crash, the resume prompt includes the checkpoint context.
- **Thread-based resume**: Each ANC task already has a workspace and `--continue` flag. Formalize this: `resolve.ts` should check for checkpoints when resuming and inject the last checkpoint context into the resume prompt (already partially done for SUSPEND.md at line 142-148).
- **Interrupt/resume pattern**: When an agent needs CEO input (`anc ask @ceo`), the task should enter an `awaiting_input` state. When the CEO responds, the system resumes the agent with the response injected. Currently, if the agent is idle when the CEO responds, the response is piped via `sendToAgent()` -- but if the agent crashed, the response is lost.

### Devin -- Compound AI System for Coding

**Architecture**: Swarm of specialized models -- Planner (reasoning), Coder (generation), Critic (review), Browser (docs). Not a single LLM session but an orchestrated pipeline.

**Dispatch model**: Planner decomposes, dispatches to specialized models. Dynamic re-planning on roadblocks (v3.0, 2026). Multiple Devin instances run in parallel, one can dispatch sub-tasks to others.

**Feedback mechanism**: v3 API provides session attribution, review integration. Code review (Devin Review) catches issues before PRs reach humans. Cross-session context maintenance.

**Failure handling**: Dynamic re-planning -- if a strategy fails, the Planner alters course automatically. Desktop computer-use capability (v2.2) for testing.

**What ANC should steal**:
- **Critic agent pattern**: After an engineer agent completes work, automatically dispatch a "critic" pass -- either a second agent or a self-review prompt. ANC already has review policies in `core/review.ts`; extend `peer-review` mode to actually spawn a reviewer agent.
- **Dynamic re-planning**: If an agent hits the same error twice (detected via process capture hooks), inject a "step back and re-plan" prompt. ANC's `hook-handler.ts` already captures tool calls; add pattern detection for repeated failures.

### OpenHands / SWE-Agent -- Event-Sourced Agent SDK

**Architecture**: Event-sourced state model with deterministic replay. Four packages: SDK, Tools, Workspace, Server. `AgentDelegateAction` enables multi-agent handoffs.

**Dispatch model**: Agent delegation via typed actions. Each agent runs in a sandboxed container. The SDK defines a composable agent interface with pluggable tools.

**Feedback mechanism**: Event stream -- all actions and observations are events. Agents can replay event history for context. REST + WebSocket APIs for external coordination.

**Failure handling**: Event replay enables deterministic recovery. Stateless agents can be restarted from event log.

**What ANC should steal**:
- **Event-sourced task history**: ANC already has `task_events` and `task_comments` tables. Extend this to a full event log: every agent action (tool call, file write, command execution) is an event. On resume, inject a condensed event summary instead of relying solely on `--continue` context.
- **AgentDelegateAction pattern**: Formalize delegation as a typed action in the SDK, not just a HANDOFF.md artifact. Add `anc delegate <taskId> @<role> "<context>"` to `sdk.ts` that creates the sub-task, dispatches the agent, and sets up the feedback callback -- all in one atomic operation.

### Claude Code Agent Teams -- Native Multi-Agent Orchestration

**Architecture**: Lead + teammates model. Shared task list (`~/.claude/tasks/{team-name}/`), mailbox system for peer-to-peer messaging. Each teammate is a full Claude Code instance with its own context window.

**Dispatch model**: Lead creates tasks, teammates self-claim or get assigned. Task dependencies with automatic unblocking. File locking prevents race conditions.

**Feedback mechanism**: Automatic message delivery. Idle notifications to lead. `TaskCompleted` hooks. Teammates can message each other directly via `SendMessage` tool.

**Failure handling**: Limited -- no session resumption for in-process teammates. Lead can spawn replacement teammates. No durable checkpointing.

**Hooks available**: `TaskCreated` (gate task creation), `TaskCompleted` (gate completion), `TeammateIdle` (keep teammate working or let it go idle).

**What ANC should steal**:
- **This is the biggest opportunity.** Claude Code Agent Teams are the native multi-agent primitive. ANC should integrate with this directly rather than building its own tmux-based multi-agent orchestration from scratch.
- **Hybrid model**: Use ANC's tmux-based spawning for independent tasks (current model, reliable). Use Claude Code Agent Teams for tasks that require real-time collaboration (debugging, cross-layer changes, design reviews).
- **Hook integration**: ANC should configure `TaskCreated`, `TaskCompleted`, and `TeammateIdle` hooks in the workspace `.claude/settings.json` that POST events to ANC's gateway. This gives ANC visibility into agent-team orchestration.

### Temporal.io -- Durable Execution for Long-Running Workflows

**Architecture**: Workflows (long-running orchestration) + Activities (external calls). Automatic state persistence. Event history for debugging. Horizontal scaling via distributed workers.

**Dispatch model**: Workflow defines the DAG. Activities are dispatched to workers. Signals and queries for external communication. Workflow `wait_condition()` for human-in-the-loop.

**Feedback mechanism**: Signals push state changes into running workflows. Queries expose workflow state for inspection. Complete event history with inputs/outputs for every step.

**Failure handling**: **The gold standard.** Automatic retry with backoff. Workflow history enables time-travel debugging. Saga pattern for compensating transactions. Workflows survive process restarts.

**What ANC should steal**:
- **Signal-based feedback**: Instead of polling, use signals. When a child task completes, ANC should "signal" the parent task's agent. Implementation: `bus.on('task:completed', ...)` -> check for parent task -> if parent agent is active, `sendToAgent()` with structured completion message. If parent is idle/suspended, store the signal for delivery on resume.
- **DAPER pattern for complex tasks**: Detect (triage) -> Analyze (understand scope) -> Plan (decompose) -> Execute (dispatch) -> Report (integrate). Map this to ANC's task lifecycle: `todo` -> `planning` -> `decomposed` -> `running` -> `integrating` -> `review`.
- **Compensating actions**: If a dispatched sub-task fails, the parent should be notified and can either retry, reassign, or escalate. Currently, child failure just sets the child task to `failed` with no parent notification.

### Research Papers -- Orchestration Patterns

Key findings from "The Orchestration of Multi-Agent Systems" (arXiv 2601.13671):

- **Five-layer model**: Planning, Execution, State, Quality, Communication. ANC has all five but they aren't integrated into a coherent pipeline.
- **Healing agents**: Agents that detect and recover from failures. ANC's circuit breaker (`circuit-breaker.ts`) is a primitive version. Need: a recovery agent that can diagnose why a task failed and either fix it or reassign.
- **MCP + A2A protocols**: Model Context Protocol for tool access, Agent-to-Agent protocol for peer coordination. ANC should adopt A2A patterns for inter-agent communication rather than inventing its own.
- **Difficulty-Aware Orchestration (DAAO)**: Adapts workflow depth, operator selection, and LLM assignment based on task difficulty. ANC should estimate task complexity and adjust: simple tasks get direct execution, complex tasks get decomposition + multi-agent.

---

## Proposed Architecture

### Agent Lifecycle Protocol (Interactive Mode)

The fundamental fix: use Claude Code hooks to close the completion loop.

**New lifecycle for interactive mode**:

```
SessionStart
  -> Agent reads task, plans, executes
  -> Agent finishes (returns to > prompt)
  -> Stop hook fires
  -> Hook checks: did the agent call `anc task status` or write HANDOFF.md?
    -> YES: system processes completion normally
    -> NO: hook injects prompt: "You appear to have finished. Please either:
            1. Write HANDOFF.md with your summary and Actions block
            2. Call `anc task status $ANC_TASK_ID review`
            3. Or continue working if you're not done."
  -> Agent responds to injected prompt
  -> If agent writes HANDOFF.md, Stop hook allows exit
  -> If agent calls `anc task status`, Stop hook allows exit
  -> System detects completion via hook event POST to gateway
```

**Implementation**:

1. **Configure `Stop` hook** in workspace `.claude/settings.json` (written by `writeAutoModeSettings()` in `runtime/workspace.ts`):

```json
{
  "hooks": {
    "Stop": [
      {
        "matcher": null,
        "hooks": [
          {
            "type": "command",
            "command": "$ANC_WORKSPACE_ROOT/.claude/hooks/completion-check.sh",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

2. **`completion-check.sh`** checks:
   - Does HANDOFF.md exist in workspace? -> Allow stop (exit 0)
   - Did the agent call `anc task status` this turn? (check via task_events table or a marker file) -> Allow stop (exit 0)
   - Is this a conversation/question task (no code changes)? -> Allow stop (exit 0)
   - Otherwise -> Block stop (exit 2 with stderr: "Write HANDOFF.md or call `anc task status` before finishing")

3. **Add `PostToolUse` hook for `anc` CLI calls**: When the agent runs `anc task status <id> review`, the PostToolUse hook POSTs to ANC gateway, which processes the status transition immediately (don't wait for tmux death).

4. **Idle detection**: Add a `SessionStart` hook that starts a background watchdog. If no tool calls occur for 5 minutes (agent at `>` prompt), inject a nudge: "Are you still working? If done, please write HANDOFF.md."

**Files to modify**:
- `src/runtime/workspace.ts` -- extend `writeAutoModeSettings()` to include hook configs
- New file: `src/runtime/hooks/completion-check.sh` -- the stop hook script
- `src/hooks/on-complete.ts` -- add handler for hook-based completion (not just tmux-death-based)
- `src/api/hook-handler.ts` -- handle `Stop` events from Claude Code hooks

### Task Decomposition Engine

**When to decompose**: Add complexity estimation to the dispatch pipeline.

```typescript
// New file: src/core/complexity.ts
interface ComplexityEstimate {
  level: 'trivial' | 'simple' | 'moderate' | 'complex' | 'epic';
  shouldDecompose: boolean;
  suggestedSubtasks?: string[];
  reasoning: string;
}

function estimateComplexity(task: Task): ComplexityEstimate {
  // Heuristics:
  // - Title/description length
  // - Number of labels
  // - Priority (P1/P2 are usually complex)
  // - Keyword detection (e.g., "redesign", "migrate", "refactor entire")
  // - Historical: similar titles in past tasks took how long?
  // Returns: level + shouldDecompose flag
}
```

**How to decompose**: Two modes.

1. **Agent-driven** (preferred): The persona tells the agent to self-assess. Add to `base.md`:
```markdown
## Task Assessment (before starting work)
1. Read the full issue description and all comments
2. Estimate complexity: trivial (<30min), simple (30min-2h), moderate (2-4h), complex (4h+)
3. If complex or epic:
   a. Write a plan as a comment: `anc task comment $ANC_TASK_ID "Plan: ..."`
   b. Decompose into sub-tasks: `anc create-sub $ANC_TASK_ID "<title>" "<description>"`
   c. Dispatch sub-tasks to appropriate agents: include role in description
   d. Track progress of sub-tasks
4. If trivial or simple: just do it
```

2. **System-driven** (fallback): When a task is created, run complexity estimation. If `shouldDecompose`, add a system prompt to the agent's spawn: "This task has been assessed as complex. Consider decomposing into sub-tasks before starting implementation."

**Files to modify**:
- New file: `src/core/complexity.ts`
- `personas/base.md` -- add task assessment protocol
- `src/runtime/runner.ts:buildDefaultPrompt()` -- inject complexity guidance
- `personas/protocols/completion.md` -- already has decomposition patterns, just needs cross-reference

### Dispatch + Feedback Loop

**Event flow**: A dispatches B -> B completes -> A gets notified -> A integrates.

```
Agent A creates sub-task (via anc create-sub or HANDOFF.md dispatches)
  -> on-complete.ts creates child task in DB with parentTaskId
  -> resolveSession() spawns Agent B

Agent B completes (writes HANDOFF.md or calls anc task status)
  -> on-complete.ts processes completion
  -> Sets child task state to 'review' or 'done'
  -> bus.emit('task:completed', { taskId, parentTaskId, handoffSummary })

NEW: on-feedback.ts handler:
  -> bus.on('task:completed', async (event) => {
       if (!event.parentTaskId) return; // no parent, nothing to notify
       
       const parentTask = getTask(event.parentTaskId);
       if (!parentTask) return;
       
       // Check if all sibling tasks are complete
       const siblings = getChildTasks(event.parentTaskId);
       const allDone = siblings.every(t => t.state === 'done' || t.state === 'review');
       const pending = siblings.filter(t => t.state !== 'done' && t.state !== 'review');
       
       // Build notification message
       const msg = allDone
         ? `All sub-tasks complete. Results:\n${siblings.map(s => `- ${s.title}: ${s.handoffSummary}`).join('\n')}\n\nPlease integrate results and write your HANDOFF.md.`
         : `Sub-task "${event.title}" completed: ${event.handoffSummary}\n${pending.length} sub-tasks remaining.`;
       
       // Deliver to parent agent
       const parentSession = getSessionForIssue(parentTask.linearIssueKey);
       if (parentSession?.state === 'active') {
         sendToAgent(parentSession.tmuxSession, msg);
       } else if (parentSession?.state === 'idle' || parentSession?.state === 'suspended') {
         // Store for delivery on resume
         addTaskComment(event.parentTaskId, 'system', msg);
         // If all done, auto-resume parent
         if (allDone) {
           resolveSession({
             role: parentTask.createdBy,
             issueKey: parentTask.linearIssueKey,
             prompt: msg,
             taskId: event.parentTaskId,
           });
         }
       }
     });
```

**Files to modify**:
- New file: `src/hooks/on-feedback.ts` -- the feedback loop handler
- `src/core/tasks.ts` -- add `getChildTasks(parentId)` query
- `src/bus.ts` -- ensure `task:completed` event includes `parentTaskId` and `handoffSummary`
- `src/hooks/on-complete.ts` -- ensure `task:completed` event payload is complete

### Long-Running Reliability

Four mechanisms, layered:

**1. Enforced checkpointing (PROGRESS.md)**

Add a `Stop` hook that fires on every agent turn. If the task has been running for >15 minutes and PROGRESS.md hasn't been updated in >10 minutes, inject: "Please update PROGRESS.md with your current status."

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "$ANC_WORKSPACE_ROOT/.claude/hooks/progress-check.sh"
          }
        ]
      }
    ]
  }
}
```

**2. Context window management**

Configure `PreCompact` and `PostCompact` hooks:
- `PreCompact`: Write current working state to `CHECKPOINT.md` before compaction
- `PostCompact`: Inject checkpoint context back after compaction via `additionalContext`

```json
{
  "hooks": {
    "PreCompact": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "$ANC_WORKSPACE_ROOT/.claude/hooks/pre-compact.sh"
          }
        ]
      }
    ],
    "PostCompact": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "$ANC_WORKSPACE_ROOT/.claude/hooks/post-compact.sh"
          }
        ]
      }
    ]
  }
}
```

**3. Rate limit handling**

Configure `StopFailure` hook for `rate_limit` matcher:
- Notify ANC gateway of rate limit
- ANC suspends the session gracefully (writes SUSPEND.md with checkpoint)
- Re-enqueues the task with a delay

**4. Crash recovery with context**

Enhance `recoverSessionsFromTmux()` in `runner.ts`:
- On recovery, read PROGRESS.md and CHECKPOINT.md from workspace
- Inject as resume context: "You are recovering from a crash. Last checkpoint: ..."
- Track crash count per task; if >2 crashes, escalate to CEO

**5. Session timeout**

Add configurable max session duration to `config/agents.yaml`:
```yaml
agents:
  engineer:
    maxSessionMinutes: 120
```

In `on-complete.ts` tick handler, check elapsed time. If exceeded, inject graceful shutdown prompt, then force-kill after 5 more minutes.

**Files to modify**:
- `src/runtime/workspace.ts` -- generate hook scripts during workspace setup
- New files: `src/runtime/hooks/{completion-check,progress-check,pre-compact,post-compact}.sh`
- `src/hooks/on-complete.ts` -- add session timeout check
- `src/runtime/runner.ts:recoverSessionsFromTmux()` -- inject checkpoint context
- `config/agents.yaml` -- add `maxSessionMinutes` field

### Quality Gates

**Three-tier pipeline**, configurable per task type and review policy:

```
Tier 1: Self-Verification (always on)
  -> Agent runs tests/linting before writing HANDOFF.md
  -> Enforced by Stop hook: check if tests pass before allowing completion
  -> If tests fail, block stop with "Tests failing. Fix before delivering."

Tier 2: Peer Review (when review policy = peer-review)
  -> On HANDOFF.md detection, instead of going directly to "In Review":
  -> System dispatches a reviewer agent with the HANDOFF summary + diff
  -> Reviewer writes REVIEW.md with approve/request-changes/reject
  -> If approved -> "In Review" (CEO approval)
  -> If request-changes -> re-dispatch original agent with feedback
  -> If rejected -> "Failed" + notify CEO

Tier 3: CEO Approval (when review policy = strict or normal)
  -> Task enters "In Review" state
  -> CEO reviews in dashboard
  -> CEO approves -> "Done"
  -> CEO requests changes -> re-dispatch agent with feedback
```

**Implementation**:

```typescript
// Extend on-complete.ts processHandoff()
async function processHandoff(session, handoffPath, workspace) {
  // ... existing quality checks ...
  
  const reviewPolicy = getReviewPolicy(session.issueKey, session.role);
  
  switch (reviewPolicy) {
    case 'autonomous':
      // Tier 1 only. Auto-complete if self-verification passes.
      // Set status to Done directly.
      break;
      
    case 'peer-review':
      // Tier 1 + Tier 2. Dispatch reviewer.
      const reviewerRole = selectReviewer(session.role); // e.g., if engineer, another engineer
      await dispatchPeerReview(session, handoff, reviewerRole);
      // Status stays "In Progress" until reviewer completes
      break;
      
    case 'lax':
      // Tier 1 + Tier 3. Go to "In Review" for CEO.
      break;
      
    case 'normal':
      // Tier 1 + Tier 3 with quality gates enforced.
      if (warnings.length > 0) {
        // Re-dispatch agent with quality feedback
        return;
      }
      break;
      
    case 'strict':
      // All three tiers.
      if (taskType === 'code') {
        await dispatchPeerReview(session, handoff, 'engineer');
      }
      break;
  }
}
```

**Files to modify**:
- `src/hooks/on-complete.ts` -- integrate review policy into processHandoff()
- `src/core/review.ts` -- add `selectReviewer()` and `dispatchPeerReview()` functions
- New file: `src/hooks/on-review.ts` -- handle REVIEW.md from reviewer agents
- `personas/protocols/` -- add `review.md` protocol for reviewer behavior

### Communication Protocol v2

Updated `personas/protocols/communication.md`:

```markdown
# Communication Protocol v2

## Lifecycle Commands

| Phase | Command | When |
|-------|---------|------|
| Start | `anc task status $ANC_TASK_ID running` | Immediately on starting work |
| Assess | `anc task comment $ANC_TASK_ID "Complexity: <level>. Plan: ..."` | After reading the task |
| Decompose | `anc create-sub $ANC_TASK_ID "<title>" "<desc>"` | If complex/epic |
| Progress | `anc progress $ANC_TASK_ID "<msg>" --percent N` | Every 15+ minutes |
| Checkpoint | Write PROGRESS.md | Before any risky operation |
| Block | `anc flag $ANC_TASK_ID "<issue>"` | If stuck for >10 minutes |
| Complete | `anc task status $ANC_TASK_ID review` + HANDOFF.md | When done |
| Delegate | `anc handoff $ANC_TASK_ID @<role> "<context>"` | When passing to another agent |

## Task Assessment Protocol (NEW)

Before starting work on any task:
1. Read full context (issue, comments, parent task if any)
2. Estimate complexity: trivial (<30min), simple (30min-2h), moderate (2-4h), complex (4h+)
3. For complex tasks:
   - Write a plan comment
   - Decompose into sub-tasks with `anc create-sub`
   - Track sub-task completion
   - Integrate results before delivering
4. For trivial/simple: execute directly

## Feedback Reception (NEW)

You may receive system messages about sub-task completions:
- "Sub-task X completed: <summary>" -> Acknowledge, continue working
- "All sub-tasks complete. Results: ..." -> Integrate results, write HANDOFF.md
- "Sub-task X failed: <reason>" -> Assess: retry, reassign, or escalate

## Interactive Mode Completion (NEW)

In interactive mode, you MUST explicitly complete your work:
1. Write HANDOFF.md with Summary + Actions block
2. Call `anc task status $ANC_TASK_ID review` (or `done` for trivial tasks)
3. The system will confirm completion via a hook
4. Do NOT just stop responding -- always write HANDOFF.md or call status
```

---

## Implementation Plan

### Phase 1: Interactive Mode Completion (Week 1)
**Priority: Critical | Effort: 3 days**

| # | Change | File | Effort |
|---|--------|------|--------|
| 1 | Generate Claude Code hook configs in workspace setup | `src/runtime/workspace.ts` | 4h |
| 2 | Create completion-check.sh Stop hook | `src/runtime/hooks/completion-check.sh` | 2h |
| 3 | Handle hook-based completion events in gateway | `src/api/hook-handler.ts` | 3h |
| 4 | Process completion without waiting for tmux death | `src/hooks/on-complete.ts` | 4h |
| 5 | Update persona protocols | `personas/protocols/completion.md`, `personas/base.md` | 1h |
| 6 | Tests for hook-based completion | `src/hooks/__tests__/on-complete.test.ts` | 3h |

**Dependencies**: None. Can start immediately.

### Phase 2: Feedback Loop (Week 1-2)
**Priority: Critical | Effort: 2 days**

| # | Change | File | Effort |
|---|--------|------|--------|
| 1 | Add `getChildTasks()` query | `src/core/tasks.ts` | 1h |
| 2 | Create feedback handler | `src/hooks/on-feedback.ts` | 4h |
| 3 | Register handler in server startup | `src/gateway.ts` or `src/hooks/index.ts` | 30m |
| 4 | Ensure task:completed event includes parentTaskId | `src/hooks/on-complete.ts` | 1h |
| 5 | Auto-resume parent when all children complete | `src/hooks/on-feedback.ts` | 2h |
| 6 | Store undelivered signals as task comments | `src/hooks/on-feedback.ts` | 1h |
| 7 | Tests | `src/hooks/__tests__/on-feedback.test.ts` | 3h |

**Dependencies**: None. Can run in parallel with Phase 1.

### Phase 3: Task Decomposition (Week 2)
**Priority: High | Effort: 2 days**

| # | Change | File | Effort |
|---|--------|------|--------|
| 1 | Complexity estimation heuristics | New: `src/core/complexity.ts` | 4h |
| 2 | Inject complexity guidance into spawn prompt | `src/runtime/runner.ts:buildDefaultPrompt()` | 2h |
| 3 | Update base persona with assessment protocol | `personas/base.md` | 1h |
| 4 | Update communication protocol v2 | `personas/protocols/communication.md` | 1h |
| 5 | Tests for complexity estimation | `src/core/__tests__/complexity.test.ts` | 2h |

**Dependencies**: Phase 2 (feedback loop needed for decomposed tasks).

### Phase 4: Long-Running Reliability (Week 2-3)
**Priority: High | Effort: 3 days**

| # | Change | File | Effort |
|---|--------|------|--------|
| 1 | Progress-check.sh hook | `src/runtime/hooks/progress-check.sh` | 2h |
| 2 | PreCompact/PostCompact hooks | `src/runtime/hooks/{pre,post}-compact.sh` | 3h |
| 3 | StopFailure rate-limit handler | `src/runtime/hooks/rate-limit-handler.sh` | 2h |
| 4 | Session timeout in tick handler | `src/hooks/on-complete.ts` | 2h |
| 5 | Enhanced crash recovery with checkpoints | `src/runtime/runner.ts:recoverSessionsFromTmux()` | 3h |
| 6 | Max session duration config | `config/agents.yaml` schema | 1h |
| 7 | Crash escalation (>2 crashes -> CEO alert) | `src/hooks/on-complete.ts` | 2h |

**Dependencies**: Phase 1 (hook infrastructure).

### Phase 5: Quality Gates Pipeline (Week 3)
**Priority: Medium | Effort: 3 days**

| # | Change | File | Effort |
|---|--------|------|--------|
| 1 | Self-verification Stop hook (run tests) | `src/runtime/hooks/verify-check.sh` | 3h |
| 2 | Peer review dispatch function | `src/core/review.ts` | 4h |
| 3 | Review handler (REVIEW.md processing) | New: `src/hooks/on-review.ts` | 4h |
| 4 | Reviewer persona protocol | New: `personas/protocols/review.md` | 2h |
| 5 | Integration with processHandoff() | `src/hooks/on-complete.ts` | 3h |
| 6 | Tests | Multiple test files | 4h |

**Dependencies**: Phase 1 + Phase 2.

### Phase 6: Claude Code Agent Teams Integration (Week 4, experimental)
**Priority: Medium | Effort: 4 days**

| # | Change | File | Effort |
|---|--------|------|--------|
| 1 | Agent Teams mode detection + enablement | `src/runtime/workspace.ts` | 2h |
| 2 | TaskCreated/TaskCompleted hook -> ANC gateway | `src/runtime/hooks/team-events.sh` | 3h |
| 3 | Spawn in Agent Teams mode for collaborative tasks | `src/runtime/runner.ts` | 6h |
| 4 | Dashboard visibility for agent teams | `apps/web/` components | 8h |
| 5 | Hybrid dispatch logic (tmux vs teams) | `src/runtime/resolve.ts` | 4h |

**Dependencies**: Phase 1-4 stable. Agent Teams is experimental in Claude Code.

---

## What Makes ANC Unique

### 1. CEO-in-the-Loop, Not Human-in-the-Loop
Every SOTA framework treats the human as an interrupt -- a gate that pauses execution. ANC treats the CEO as a team leader who gives direction, reviews work, and makes decisions asynchronously. The agent keeps working; the CEO steers. No other system models this "async CEO oversight" pattern.

### 2. Persistent Agent Identity + Memory
CrewAI, AutoGen, and LangGraph agents are stateless between runs. ANC agents have persistent personas, accumulated memory across sessions, retrospectives, and evolving beliefs. An ANC engineer agent that has worked on the codebase for 3 months knows things a fresh CrewAI agent never will.

### 3. Real Infrastructure, Not a Framework
CrewAI and AutoGen are Python libraries you import. ANC is a running system with a database, event bus, API, dashboard, and native app. It's the difference between a UI framework and an operating system. You don't build on ANC -- you run your company in it.

### 4. Linear/External Integration as First-Class
ANC doesn't just orchestrate agents -- it integrates with the CEO's existing workflow (Linear for project management, Discord for team chat, Telegram for notifications). No SOTA framework has this level of external integration.

### 5. Process Capture + Cost Transparency
ANC captures every tool call via Claude Code hooks and tracks cost per task. The CEO sees exactly what agents are doing and what it costs. No other orchestration system provides this granularity.

### 6. Review Policy System
The 5-tier review policy (strict/normal/lax/autonomous/peer-review) with per-task/project/role precedence is unique. No SOTA framework has configurable quality assurance at this granularity.

### 7. One-Person Scale
Every SOTA system is designed for engineering teams. ANC is designed for one person running an entire company. The constraints are different: the CEO can't attend standup with 4 agents. Everything must be async, auditable, and interruptible. This "solo CEO + AI team" operating model has no equivalent in the market.
