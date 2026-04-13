# ANC Product Research — World-Class Feature Analysis

## Executive Summary

Top 10 recommendations ranked by impact on making ANC world-class:

1. **Model Router + Task Complexity Classifier** — Route simple tasks (triage, labeling) to Haiku/Sonnet, reserve Opus for architecture and complex debugging. Expected 60-80% cost reduction. (`src/runtime/model-router.ts`, extend `config/agents.yaml`)
2. **Reflexion Self-Verification Loop** — Before writing HANDOFF.md, agents run a generate-verify-reflect cycle: execute tests, check output, reflect on failures, retry. Proven 6+ point improvements on code benchmarks. (`personas/protocols/verification.md`, `src/hooks/on-complete.ts`)
3. **Agent Mission Control Dashboard** — GitHub's Copilot Mission Control pattern: single-pane view with session logs, file diffs, and real-time steering side-by-side. CEO sees all 3 agents in one view with live status. (`apps/web/` new Mission Control page)
4. **Persona Dimension Expansion** — Add decision-making style, risk tolerance, escalation thresholds, and reasoning-over-rules principles to persona files. Current personas define scope but not behavioral style. (`personas/roles/*.md`, `personas/base.md`)
5. **Prompt Caching for Agent Sessions** — Stable tool definitions + persona prefix cached across agent sessions. 45-80% cost reduction on repeated prompts with 85% latency improvement. (`src/runtime/runner.ts` cache control headers)
6. **Hierarchical Task Decomposition with Dynamic Re-planning** — Adopt TDAG pattern: planner agent creates subtask tree, executor agents can dynamically adjust based on completion status. Doubles success rate over flat ReAct. (`src/agents/planner.ts`)
7. **Observability Layer** — Per-task token usage, cost attribution, decision trace replay, latency tracking. Current process capture is raw tool calls; add structured traces. (`src/core/observability.ts`, dashboard cost attribution view)
8. **Spending Guardrails with Hard Caps** — Per-task max budget with automatic suspension, per-session timeout, filesystem sandboxing to workspace directory. (`src/runtime/resolve.ts`, `src/core/budget.ts`)
9. **Semantic Cache for Repeated Queries** — 31% of LLM queries are semantically similar to previous ones. Cache agent research/analysis results. (`src/core/semantic-cache.ts`)
10. **Multi-Tier Review Gates** — Expand review policy with automated pre-checks (tests pass, lint clean, no secrets) before human review. (`src/core/review.ts` pre-check pipeline)

---

## 1. Agent Persona / Identity

### SOTA Analysis

**Character.ai** pioneered persistent persona systems with detailed character cards: personality traits, speech patterns, knowledge boundaries, example conversations, and behavioral constraints. Key insight: personas need both "what I know" and "how I behave."

**Anthropic's Constitutional AI** teaches models *why* to behave rather than *what* to do. Reasoning-based instructions outperform rule-based ones. Claude's published constitution demonstrates that principles > rigid rules.

**Microsoft AutoGen/Agent Framework** defines agents with `system_message` + `description` + `tools` + `model_config`. The v0.4 architecture adds pluggable memory, middleware, and telemetry per agent. Key: agent profiles are runtime-configurable, not static files.

**Academic research** (Persona Ecosystem Playground, 2026) shows that multi-dimensional persona modeling with behavioral archetypes produces more consistent agent behavior than flat descriptions.

### What ANC Has

- Composable persona builder (`base.md` + `role/*.md` + `protocols/*.md`) -- excellent architecture
- Memory frontmatter with importance ranking (critical/high/normal/low) -- ahead of most systems
- Identity header in spawned sessions
- Persona tuner for gap/overlap analysis

### What ANC Should Adopt

**Add behavioral dimensions to persona files:**

| Dimension | Current | Should Add |
|-----------|---------|------------|
| Expertise scope | Yes (roles/*.md) | -- |
| Communication style | Partial (protocols) | Explicit tone + formality level |
| Decision-making style | No | Conservative vs. bold, ask-first vs. act-first |
| Risk tolerance | No | Low/medium/high per domain |
| Escalation threshold | No | When to ask CEO vs. decide autonomously |
| Reasoning style | No | Principles-based (why) not rules-based (what) |
| Learning rate | No | How aggressively to update memory/beliefs |
| Confidence calibration | No | When to say "I'm not sure" vs. proceed |

**Implementation:**
- `personas/base.md` — Add a `## Behavioral Principles` section with reasoning-based guidelines (Constitutional AI style)
- `personas/roles/*.md` — Add `## Decision Style` and `## Risk Profile` sections
- `config/agents.yaml` — Add `riskTolerance: low|medium|high` and `autonomyLevel: supervised|semi|autonomous` per agent

### Implementation Priority
**High** — 2-4 hours. Pure persona file edits, no code changes needed.

---

## 2. Task Decomposition

### SOTA Analysis

**ReAct** (Thought-Action-Observation loop): Simple, effective for single-step tasks. ANC agents already use this implicitly through Claude Code's native loop.

**Tree of Thoughts**: Explores multiple solution paths in parallel. Overkill for most coding tasks but valuable for architecture decisions.

**Plan-and-Execute** (LangGraph): Separate planner creates step list, executor handles each step. Good for predictable workflows, fragile when plans need revision.

**TDAG Framework** (May 2025): Dynamically generates specialized subagents per subtask with an evolving skill library. Adjusts subsequent subtasks based on completion status. Best for complex, multi-file changes.

**ReAcTree** (NeurIPS 2025): Hierarchical agent trees that decompose goals into subgoals. 61% success rate vs. ReAct's 31% on complex tasks. Key: each tree node is an independent agent with its own context.

**Devin's Architecture**: Compound system with Planner (strategy), Coder (execution), Critic (review), Browser (research). Supports dynamic re-planning when hitting roadblocks.

### What ANC Has

- Agent self-decomposition via `anc create-sub` — agents create sub-issues
- HANDOFF.md dispatches to other roles
- Parent-child task tree tracking
- Standing duties engine for proactive behaviors
- ROADMAP.md explicitly says "No LLM-in-the-loop planner needed"

### What ANC Should Adopt

The ROADMAP's "no planner" stance was correct for Phase A/B (go-live, hardening). For world-class, ANC needs **lightweight dynamic decomposition**:

1. **Keep self-decomposition as default** — For tasks under 2 hours estimated, the assigned agent decomposes itself. This is working.

2. **Add a "planning mode" for complex tasks** — When a task is tagged `complex` or estimated >4 hours, the CEO Office agent runs first as a planner:
   - Reads the issue + codebase context
   - Produces a structured plan with subtasks, dependencies, and estimated effort
   - CEO reviews plan before execution begins
   - Plans are stored in task metadata for later evaluation

3. **Dynamic re-planning on failure** — If an agent writes BLOCKED.md or fails 2x on a subtask, trigger a re-planning step that can restructure remaining subtasks.

**Implementation:**
- `src/agents/planner.ts` — New module: `planTask(issueKey)` that produces structured subtask tree
- `personas/protocols/planning.md` — New protocol for planning-mode behavior
- `config/agents.yaml` — Add `planningCapable: true` to ceo-office agent
- `src/hooks/on-issue.ts` — Check for `complex` label, route to planner first

### Implementation Priority
**Medium** — 8-12 hours. New module + protocol + routing logic.

---

## 3. Quality Assurance / Self-Verification

### SOTA Analysis

**Reflexion** (NeurIPS 2023, extended 2025): Generate-verify-reflect loop. Agent attempts task, evaluates result against tests/criteria, writes verbal self-reflection, retries with reflection as context. +6.2 points on HumanEval.

**Multi-Agent Reflexion (MAR)**: Multiple specialized "critic" personas review the same output, a judge synthesizes their feedback. Reduces blind spots from single-reviewer bias.

**SWE-Bench Verified patterns**: Top-scoring agents (>50% on SWE-Bench Verified) all share: (1) test generation before fix, (2) test execution after fix, (3) regression checks on existing tests, (4) iterative refinement with test feedback.

**Devin's Critic Model**: Adversarial model that reviews code for security vulnerabilities and logic errors before PR submission.

**Differential Patch Testing** (SWE-Bench+): Compares behavioral differences between patches, catching 29.6% of "plausible but wrong" solutions that pass standard tests.

### What ANC Has

- Engineer persona has a Self-QA Checklist (tests pass, coverage, e2e verification)
- HANDOFF.md quality gates (content length, verification section)
- Review policy system (strict/normal/lax/autonomous/peer-review)
- Process capture shows what agents did

### What ANC Should Adopt

1. **Mandatory verification protocol** — New protocol `personas/protocols/verification.md`:
   ```
   Before writing HANDOFF.md:
   1. Run the project's test suite — record pass/fail count
   2. If you wrote new code, write at least one test for it
   3. Run the specific test you wrote — it must pass
   4. Check for regressions: any previously-passing tests now failing?
   5. Self-review: re-read your diff. Would a staff engineer approve?
   6. If any step fails, reflect on why, fix, and repeat (max 3 iterations)
   ```

2. **Structured verification block in HANDOFF.md** — Require machine-parseable verification results:
   ```yaml
   ## Verification
   tests_run: 127
   tests_passed: 127
   new_tests_added: 3
   self_review_passed: true
   iterations: 1
   ```
   Parse this in `src/hooks/on-complete.ts` and block auto-done if tests failed.

3. **Peer review for non-trivial changes** — When `review.yaml` is set to `peer-review`, automatically dispatch to a second agent for code review before marking done.

4. **Post-completion regression check** — After agent marks done, run a lightweight check (e.g., `npm test`) from outside the agent session. If it fails, auto-reopen.

**Implementation:**
- `personas/protocols/verification.md` — New verification protocol
- `src/hooks/on-complete.ts` — Parse verification block, enforce gates
- `src/core/verification.ts` — Post-completion test runner
- `config/agents.yaml` — Add `verification.md` to all agent protocol lists

### Implementation Priority
**Critical** — 6-8 hours. This is the single biggest quality lever.

---

## 4. Real-time Collaboration UX

### SOTA Analysis

**Figma's Multiplayer**: WebSocket connections to in-memory state server. CRDT-based conflict resolution. Checkpoints every 30-60 seconds. Latency in milliseconds via LiveGraph (GraphQL subscriptions over Postgres replication stream).

**Linear's Real-time Sync**: Optimistic UI updates with eventual consistency. Every mutation is immediately reflected locally, synced in background. Issue state changes propagate in <500ms.

**GitHub Mission Control** (Oct 2025): Single-pane view for agent tasks with:
- Session logs next to file diffs
- Real-time steering (send input while agent works)
- Task status at a glance
- Jump to associated PRs
- Multi-platform: web, CLI, mobile, VS Code

**Notion's Block-level Sync**: Each block is independently editable. Conflicts resolved at block level, not page level.

### What ANC Has

- WebSocket real-time events (`api/ws.ts`)
- Process capture streaming (tool calls in real-time)
- 3-pane Tasks view with inline editing
- Agent terminal view (per-agent output)
- Pulse dashboard with company health

### What ANC Should Adopt

1. **Mission Control View** — Single page showing all active agent sessions:
   - Left rail: list of active tasks with status badges (running/blocked/review)
   - Center: selected task's live process stream (current tool calls, files being edited)
   - Right: task properties + file diff preview
   - Bottom: steering input (send follow-up message to agent via `tmux send-keys`)
   - Real-time: every bus event updates the view with no refresh

2. **Activity Timeline** — Per-task chronological view:
   - Agent assigned → planning → coding → testing → review → done
   - Each phase shows duration, files touched, cost incurred
   - Collapsible detail: click to see actual tool calls

3. **Fleet Dashboard Widget** — On Pulse page:
   - 3-4 agent cards showing: current task, progress indicator, token spend
   - Sparkline charts: cost/hour over last 24h
   - Queue depth indicator

4. **Optimistic UI** — Apply state changes immediately on client, reconcile via WebSocket:
   - Task drag-and-drop status changes: instant feedback
   - Comment posting: show immediately, sync in background

**Implementation:**
- `apps/web/src/app/mission-control/page.tsx` — New Mission Control page
- `apps/web/src/components/activity-timeline.tsx` — Timeline component
- `apps/web/src/components/fleet-widget.tsx` — Fleet status widget
- `src/api/ws.ts` — Add structured event types for timeline events

### Implementation Priority
**High** — 16-24 hours. This is the CEO's primary interface.

---

## 5. Cost Optimization

### SOTA Analysis

**Prompt Caching** (Anthropic): Cache reads cost 0.1x base price (90% discount). 5-min TTL write costs 1.25x, 1-hour TTL costs 2x. Cache hits reduce latency 85% on 100K+ token prompts. Critical: cache invalidates if ANY prefix byte changes.

**Model Routing**: UC Berkeley/Canva research shows 85% cost reduction maintaining 95% of Opus performance. Three-tier routing: Haiku for classification/triage ($0.50/Mtok), Sonnet for moderate tasks ($10/Mtok), Opus for complex reasoning ($30/Mtok).

**Semantic Caching**: 31% of queries are semantically similar to prior ones. Redis LangCache achieves ~73% cost reduction in high-repetition workloads.

**Context Window Management**: Anthropic's Compaction API (Feb 2026) enables automatic conversation summarization for effectively infinite sessions. Strategies: sliding window, hierarchical summarization, selective retention.

**Token Budget Estimation**: Estimate task cost before starting based on historical data. Alert if estimated cost exceeds threshold.

### What ANC Has

- Daily + per-agent budget limits (`core/budget.ts`)
- Cost extraction from Claude Code transcripts
- Budget alerts at configurable thresholds
- Unlimited mode for development (`ANC_BUDGET_DISABLED=true`)

### What ANC Should Adopt

1. **Model Router** — New module `src/runtime/model-router.ts`:
   ```
   Task complexity classifier:
   - Simple (triage, label, comment): route to Sonnet → 10-15x cheaper
   - Standard (single-file fix, docs): Sonnet with Opus fallback
   - Complex (multi-file architecture, debugging): Opus only
   Classification based on: label, title keywords, estimated scope, historical data
   ```

2. **Per-Task Budget Caps** — Add `maxBudget` field to task entity:
   - Estimate cost before spawn based on task type historical average
   - Auto-suspend if task exceeds 2x estimated budget
   - CEO alert at 1.5x threshold
   - New column in `tasks` table: `budget_limit_usd`, `estimated_cost_usd`

3. **Prompt Caching Strategy** — Keep persona + tool definitions stable as cache prefix:
   - Persona files are the static prefix (persona + protocols + SDK reference)
   - Mark with `cache_control` in API calls
   - Keep tool definitions fixed (don't add/remove tools between calls)
   - Expected savings: 45-80% on persona injection costs

4. **Session Duration Limits** — Add configurable max session time:
   - Default: 60 minutes per session
   - Configurable per task type in `config/budget.yaml`
   - Warning at 80%, force-suspend at 100%
   - `src/runtime/health.ts` — Add timer-based eviction

5. **Cost Analytics Dashboard** — New dashboard view:
   - Cost per task, per agent, per day (charts)
   - Cost efficiency: $/completed-task trend
   - Projected monthly spend
   - Wasted spend: cost on failed/abandoned tasks

**Implementation:**
- `src/runtime/model-router.ts` — Task complexity classifier + model selection
- `config/budget.yaml` — Add `sessionTimeout`, `perTaskDefault` fields
- `src/core/budget.ts` — Per-task budget tracking
- `apps/web/src/app/costs/page.tsx` — Cost analytics page
- `src/runtime/health.ts` — Session timeout enforcement

### Implementation Priority
**Critical** — 12-16 hours. Direct $$$ impact.

---

## 6. Developer Experience / SDK Design

### SOTA Analysis

**Vercel AI SDK**: Streaming-first, 25+ provider integrations, React hooks (useChat, useCompletion). Key: developer never manages connection state manually. TypeScript-native with full type inference.

**Claude Code Hooks/Extensions**: Pre/post tool-use hooks, process capture webhooks. Clean event model. ANC already leverages this well.

**OpenAI Assistants API**: File uploads, code interpreter, retrieval, function calling. Key insight: tools are first-class, discoverable via API.

**LangChain**: 1000+ integrations but debugging is hard ("you debug LangChain's internals, not your own logic"). Lesson: keep abstractions thin.

### What ANC Has

- `anc` CLI with 16+ commands (agent, task, company, batch, doctor, SDK)
- Agent SDK (`agents/sdk.ts` + `sdk-cli.ts`): comment, dispatch, status, create-sub, plan, ask
- `anc doctor` for diagnostics
- Hook handler for Claude Code integration
- YAML-based config (agents, routing, budget, review, duties)

### What ANC Should Adopt

1. **Tool Discovery for Agents** — Agents should be able to query available tools/capabilities at runtime:
   - `anc tools list` — Show all available SDK commands with descriptions
   - `anc tools help <command>` — Detailed usage for a specific tool
   - Auto-inject tool reference into persona (already done via `buildSdkReference()` -- verify it's complete)

2. **`anc init` for New Projects** — When ANC manages a new codebase:
   - Scan for test commands, build commands, lint commands
   - Generate a project-specific `.anc/project.yaml` with discovered commands
   - Agents read this to know how to build/test in each project

3. **Agent-to-Agent Messaging** — Currently agents communicate via sub-issues. Add direct messaging:
   - `anc ask <role> "<question>"` — Synchronous question to another agent
   - `anc notify <role> "<message>"` — Async notification
   - Backed by `task_comments` table with `type: a2a`

4. **Plugin/Extension System** — Allow custom post-completion hooks:
   - `hooks/` directory with user scripts (already exists as a concept)
   - `anc hook add post-complete "./scripts/deploy.sh"` — Register hooks
   - Event-driven: hook scripts receive event JSON on stdin

5. **`anc replay <taskId>`** — Replay a task's decision trace for debugging:
   - Show chronological: agent spawned → tools used → decisions made → outcome
   - Useful for post-mortem analysis

**Implementation:**
- `src/commands/init.ts` — Project initialization scanner
- `src/commands/replay.ts` — Decision trace replay
- `src/agents/messaging.ts` — Direct agent-to-agent messaging
- `docs/sdk-reference.md` — Complete SDK documentation for agents

### Implementation Priority
**Medium** — 8-12 hours. Quality of life improvements.

---

## 7. Observability / Process Transparency

### SOTA Analysis

**LangSmith**: Auto-traces every LLM call, captures prompts/outputs, tracks costs/latency. Trace visualization shows exactly where in a chain a problem occurred. Dataset-based evaluation.

**Braintrust**: Real-time metrics (latency, cost, quality scores). Alerts on quality threshold violations. Multi-step trace visualization.

**Helicone**: Proxy-based (one-line integration). Logs requests, responses, tokens, costs. Dashboard with per-model, per-user breakdowns.

**Common patterns across all tools:**
- Structured traces (span-based, like OpenTelemetry)
- Cost attribution to specific features/tasks
- Latency percentiles (p50, p95, p99)
- Quality scoring (automated + human)
- Alerting on anomalies

### What ANC Has

- Process capture (Claude Code hooks — tool calls streamed in real-time)
- Budget tracking with cost per session
- Event logging to SQLite (`core/events.ts`)
- WebSocket broadcasting of all bus events
- Health endpoint with component-level status

### What ANC Should Adopt

1. **Structured Trace Model** — Every agent session produces a trace:
   ```
   Trace: task-123
   ├── Span: planning (2.3s, $0.02)
   ├── Span: file_read (0.1s, $0.001)
   ├── Span: code_edit (5.1s, $0.05)
   ├── Span: test_run (12.0s, $0.00)
   ├── Span: reflection (3.2s, $0.03)
   └── Span: handoff_write (0.5s, $0.005)
   ```
   Store in `trace_spans` table. Visualize as waterfall in dashboard.

2. **Cost Attribution Dashboard** — Per-task, per-agent, per-project cost breakdown:
   - Which tasks are expensive? Which agents spend most?
   - Cost trend lines over time
   - Wasted spend (failed tasks, abandoned sessions)
   - Budget burn rate with projected monthly total

3. **Decision Trace Replay** — For any completed task, show the agent's decision chain:
   - What files were read? What was the plan? Where did it pivot?
   - Useful for CEO to understand agent reasoning quality
   - Source: process capture events + HANDOFF.md content

4. **Quality Metrics** — Track per-agent:
   - First-attempt success rate (tasks completed without retry)
   - Review rejection rate (how often CEO rejects work)
   - Average iterations to completion
   - Memory quality (are memories being referenced by future sessions?)

5. **Alerting** — Beyond budget alerts:
   - Agent stuck for >30min with no tool calls → alert
   - Test failure rate >50% on a task → alert
   - Queue depth >10 → alert
   - Circuit breaker tripped → alert

**Implementation:**
- `src/core/observability.ts` — Trace/span model, quality metrics
- New DB table: `trace_spans (id, task_id, agent, span_type, start, end, cost, metadata)`
- `apps/web/src/app/traces/page.tsx` — Trace explorer page
- `apps/web/src/components/cost-dashboard.tsx` — Cost attribution widget
- `src/hooks/on-session.ts` — Emit span events for trace construction

### Implementation Priority
**High** — 12-16 hours. Essential for CEO confidence and cost control.

---

## 8. Safety / Guardrails

### SOTA Analysis

**NeMo Guardrails** (NVIDIA): Config-file-based guardrails (Colang language). Handles input/output filtering, topic control, fact-checking, and hallucination detection. Covers 80% of common safety requirements with simple config.

**Guardrails AI**: Validator-based approach. Input validators (PII detection, prompt injection) and output validators (factual accuracy, format compliance, toxicity). Composable pipeline.

**Superagent** (2025): Open-source framework specifically for guardrails around agentic AI. Focuses on action-level permissions (what an agent can DO, not just what it can SAY).

**Key incidents (2025-2026)**: AI coding agent deleted a production database by ignoring a code freeze. An agent exposed customer data by accessing files outside its sandbox. These are real risks.

**Regulatory landscape**: EU AI Act (2025) classifies AI by risk level. Singapore published first governance framework for agentic AI (Jan 2026). Guardrails are becoming legally required for high-risk applications.

### What ANC Has

- Kill switch (global pause/resume) — excellent
- Budget limits (daily + per-agent) — good
- Circuit breakers (per-issue, exponential backoff) — good
- Review policy (5 levels from strict to autonomous) — good
- Workspace isolation (per-issue directories) — good
- Dedup/rate-limiting — good

### What ANC Should Adopt

1. **Filesystem Sandboxing** — Agents should ONLY access:
   - Their workspace: `~/anc-workspaces/<taskId>/`
   - Their memory: `~/.anc/agents/<role>/memory/`
   - Shared memory: `~/.anc/memory/shared/`
   - BLOCK: `~/.ssh/`, `~/.env`, `~/.aws/`, any credentials directory
   - Enforce via Claude Code `--permission-mode` flags + workspace CLAUDE.md restrictions

2. **Per-Task Spending Limits** — Hard cap per task (not just daily):
   - Default: $5/task for standard, $20/task for complex
   - Auto-suspend when limit reached
   - CEO notification with option to extend
   - Track in `tasks` table: `budget_limit_usd`

3. **Network Access Controls** — Define allowed outbound connections:
   - Default allow: npm registry, GitHub, documentation sites
   - Default deny: arbitrary URLs, internal network
   - Configurable per agent role in `config/agents.yaml`

4. **Dangerous Operation Gates** — Auto-pause and notify CEO before:
   - `rm -rf` on directories outside workspace
   - `git push --force` to main/master
   - Database migrations or schema changes
   - Deployment commands
   - Implement via Claude Code hooks (PreToolUse hook that checks command)

5. **Session Timeout** — Prevent runaway sessions:
   - Default: 60 minutes max
   - Warning at 45 minutes
   - Force-suspend with HANDOFF.md prompt at 60 minutes
   - Configurable per task type

6. **Audit Trail** — Every agent action logged immutably:
   - File operations: create/edit/delete with before/after
   - External API calls: Linear, GitHub
   - Cost events: token usage per API call
   - Already partially done via events table; ensure completeness

**Implementation:**
- `personas/protocols/safety.md` — Safety protocol for all agents
- `config/safety.yaml` — Filesystem allowlist, network rules, spending caps
- `src/core/safety.ts` — Safety policy enforcement
- `src/hooks/on-session.ts` — Session timeout timer
- Claude Code hooks in `hooks/` — PreToolUse command filtering

### Implementation Priority
**Critical** — 8-12 hours. Prevents catastrophic failures.

---

## Cross-cutting Themes

Patterns that appear across multiple research areas:

1. **Layered autonomy** — Every SOTA system uses graduated trust levels. ANC's review policy (strict→autonomous) is the right foundation. Extend it to encompass all guardrail dimensions (filesystem, network, spending, deployment).

2. **Reflect-before-complete** — Reflexion, Devin's Critic, SWE-Bench top performers all add a self-evaluation step. This is the highest-impact single change ANC can make.

3. **Cost-aware routing is table stakes** — Every production LLM system uses model routing. ANC using Opus for everything is burning money. Even simple Sonnet routing saves 60%+.

4. **Single-pane mission control** — GitHub, Linear, Figma all converge on: one view, real-time updates, steering without context-switching. ANC's dashboard is good but needs a unified Mission Control for the CEO's primary workflow.

5. **Traces, not logs** — Modern observability is span-based traces (OpenTelemetry style), not flat log lines. ANC should adopt structured traces for every agent session.

6. **Behavioral identity > capability lists** — The best persona systems define HOW agents think, not just WHAT they can do. Principles-based guidance (Constitutional AI style) outperforms rule-based.

---

## ANC's Unique Advantages

What ANC has that no competitor offers in combination:

1. **One-person company operating model** — No other system is purpose-built for a single CEO running an AI team. This is a genuine market niche.

2. **Interactive tmux sessions** — Agents run as persistent, interactive Claude Code sessions that the CEO can observe and steer in real-time. Most competitors use stateless API calls.

3. **Composable persona system with layered memory** — Frontmatter-based importance ranking, strategic/domain/project layers, memory caps. More sophisticated than AutoGen, LangChain, or Devin's approaches.

4. **Event-driven architecture with typed bus** — Clean separation of concerns across 10+ hook handlers. Most agent frameworks are monolithic.

5. **Native macOS app + web dashboard** — Full feature parity across platforms. No competitor offers both.

6. **Standing duties engine** — Proactive behaviors (health checks, pulse reports) driven by YAML config. Agents do work without being asked.

7. **Kill switch + circuit breakers** — Production-grade safety that most agent frameworks lack entirely.

8. **Agent-decided task lifecycle** — Agents control their own status transitions and dispatches via structured HANDOFF.md. Most systems require external orchestration.

---

## 90-day Roadmap

### Month 1: Safety + Quality + Cost (Weeks 1-4)

| Week | Feature | Files | Hours |
|------|---------|-------|-------|
| 1 | Verification protocol + HANDOFF.md gates | `personas/protocols/verification.md`, `src/hooks/on-complete.ts` | 6 |
| 1 | Per-task budget caps + session timeout | `src/core/budget.ts`, `src/runtime/health.ts` | 4 |
| 2 | Model router (Haiku/Sonnet/Opus) | `src/runtime/model-router.ts`, `config/agents.yaml` | 8 |
| 2 | Filesystem sandboxing + safety protocol | `personas/protocols/safety.md`, `config/safety.yaml` | 4 |
| 3 | Persona dimension expansion | `personas/roles/*.md`, `personas/base.md` | 3 |
| 3 | Dangerous operation gates (PreToolUse hooks) | `hooks/pre-tool-use.sh` | 4 |
| 4 | Prompt caching strategy for sessions | `src/runtime/runner.ts` | 6 |

### Month 2: Observability + Dashboard (Weeks 5-8)

| Week | Feature | Files | Hours |
|------|---------|-------|-------|
| 5 | Structured trace model + DB schema | `src/core/observability.ts`, migration | 8 |
| 5 | Cost attribution dashboard | `apps/web/src/app/costs/page.tsx` | 6 |
| 6 | Mission Control page | `apps/web/src/app/mission-control/page.tsx` | 12 |
| 7 | Activity timeline component | `apps/web/src/components/activity-timeline.tsx` | 6 |
| 7 | Quality metrics (success rate, iterations) | `src/core/observability.ts` | 4 |
| 8 | Alerting system (stuck agent, queue depth) | `src/core/alerts.ts`, `config/alerts.yaml` | 6 |

### Month 3: Intelligence + DX (Weeks 9-12)

| Week | Feature | Files | Hours |
|------|---------|-------|-------|
| 9 | Planning mode for complex tasks | `src/agents/planner.ts`, `personas/protocols/planning.md` | 10 |
| 9 | Dynamic re-planning on failure | `src/hooks/on-complete.ts` | 4 |
| 10 | Agent-to-agent direct messaging | `src/agents/messaging.ts` | 6 |
| 10 | Decision trace replay command | `src/commands/replay.ts` | 4 |
| 11 | `anc init` project scanner | `src/commands/init.ts` | 4 |
| 11 | Semantic cache for repeated analysis | `src/core/semantic-cache.ts` | 8 |
| 12 | Fleet dashboard widget on Pulse | `apps/web/src/components/fleet-widget.tsx` | 4 |
| 12 | Post-completion automated regression check | `src/core/verification.ts` | 6 |

**Total estimated effort: ~135 hours over 12 weeks**

---

*Research conducted April 2026. Sources include Anthropic docs, SWE-Bench publications, Figma engineering blog, GitHub Copilot changelog, NVIDIA NeMo Guardrails, Reflexion (NeurIPS 2023), ReAcTree (NeurIPS 2025), TDAG Framework (2025), Braintrust/Helicone/LangSmith documentation, Vercel AI SDK docs, and Microsoft Agent Framework documentation.*
