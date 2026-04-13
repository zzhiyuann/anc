# ANC Self-Optimization System Design

## Concept

Apply autoresearch principles: the system continuously experiments with its own
configuration and optimizes based on measured outcomes. Like Karpathy's
autoresearch runs hundreds of ML experiments overnight on a single GPU, ANC
runs controlled experiments on its own agent configuration and keeps only what
improves measured results.

The core insight: **ANC already collects all the data needed** (retrospectives,
quality scores, cost logs, task events, persona tuner output). What's missing is
a feedback loop that automatically adjusts configuration based on that data.

## Prior Art

| System | Core Idea | Applicable to ANC |
|--------|-----------|-------------------|
| **Karpathy autoresearch** | Fixed eval metric + fixed time budget + ratchet (keep only improvements). 3 files: constants, code, instructions. Agent edits code, trains, measures, keeps/discards. | Direct analog: ANC agents have personas (code), tasks (training), quality scores (metric). Run persona variants, measure outcomes, ratchet. |
| **DSPy** (Stanford) | Program-not-prompt. Define signatures + metrics, compiler finds optimal prompts/demos. MIPROv2 uses Bayesian optimization over instruction+demo space. | ANC personas are effectively DSPy "signatures". Could compile optimal persona instructions from task outcome data. |
| **TextGrad** | Backpropagate textual feedback through computation graphs. LLM provides "gradients" (natural language suggestions) to improve each component. Published in Nature. | Use quality review feedback as textual gradients to refine personas. Review comments = loss signal. |
| **ADAS** (ICLR 2025) | Meta Agent Search: a meta-agent iteratively programs better agents from an archive of prior designs. Up to 14% improvement on ARC. | CEO Office agent as meta-agent that designs better agent configurations from the archive of past experiments. |
| **OPRO** (DeepMind) | LLM-as-optimizer: describe optimization task in natural language, LLM proposes solutions, evaluate, add to prompt, repeat. Up to 50% improvement on Big-Bench. | Directly applicable to routing rule optimization and review policy tuning. |
| **Voyager** (NVIDIA) | Skill library of executable code indexed by description embedding. Lifelong learning through reusable verified skills. 3.3x more unique items than baselines. | Agent memory files as skill library. Verified solutions become reusable patterns indexed by task type. |

## What Gets Optimized

### 1. Agent Prompts/Personas
**Question:** Which instructions produce the best task outcomes for each role?

**Mechanism:** DSPy-style compilation. Define persona as a signature (role +
capabilities + protocols), define metric (quality score + completion rate +
cost), let the optimizer propose instruction variants. Evaluate variants against
the metric over N tasks. Ratchet: keep only improvements.

**Data source:** `retrospectives/*.md`, quality scores from P1 verification gate.

### 2. Memory Strategy
**Question:** Which memory files most improve task success rate?

**Mechanism:** Voyager-style skill library. Track which memory files were
injected into each task's workspace CLAUDE.md and correlate with task outcomes.
Prune memory files that never correlate with success. Promote memory files that
correlate with high quality scores.

**Data source:** `task_events` (memory injection logs), quality scores, task
completion data.

### 3. Routing Rules
**Question:** Which agent handles which task type best?

**Mechanism:** OPRO-style optimization. Current routing is declarative YAML
(label/project/keyword matching). Track success rate per (task-type, agent)
pair. When an agent consistently underperforms on a task type, propose routing
rule changes. Evaluate over next N tasks.

**Data source:** `sessions` (role, issue_key, state), `events`
(agent:completed vs agent:failed), `budget_log` (cost per task per role).

### 4. Model Selection
**Question:** Which model tier (opus/sonnet/haiku) for which task type gives
the best cost/quality tradeoff?

**Mechanism:** A/B testing. For tasks with similar complexity, randomly assign
different model tiers. Measure quality score vs cost. Build a Pareto frontier.
Shift routing toward the Pareto-optimal model per task type.

**Data source:** `sessions.model_tier`, `budget_log.cost_usd`, quality scores.

### 5. Review Policy
**Question:** Which strictness level per role produces the best outcomes?

**Mechanism:** Track task rejection rate, rework cycles, and final quality under
each review policy (strict/normal/lax/autonomous). Tighten policy where quality
dips, loosen where rejection rate is high but quality is already good.

**Data source:** `review.yaml` config, task state transitions
(review -> running = rework), final quality scores.

### 6. Decomposition Strategy
**Question:** When to split tasks, and how to split them?

**Mechanism:** Track parent-child task trees. Measure: single-task completion
rate vs decomposed completion rate at similar complexity. Identify complexity
thresholds where decomposition improves outcomes. Adjust the auto-decompose
threshold.

**Data source:** `tasks.parent_task_id`, `task_feedback`, completion times,
quality scores.

## Optimization Loop

Modeled on Karpathy's autoresearch ratchet:

```
┌─────────────────────────────────────────────────────┐
│                   CEO Office Agent                   │
│              (Meta-Agent / Optimizer)                 │
└──────────────────────┬──────────────────────────────┘
                       │
           ┌───────────▼───────────┐
           │   1. OBSERVE          │
           │   Collect metrics:    │
           │   - Quality scores    │
           │   - Success rates     │
           │   - Cost per task     │
           │   - Completion times  │
           │   - Retrospectives    │
           └───────────┬───────────┘
                       │
           ┌───────────▼───────────┐
           │   2. HYPOTHESIZE      │
           │   Analyze data for    │
           │   underperformance:   │
           │   - Agent X fails on  │
           │     task type Y       │
           │   - Persona missing   │
           │     key instruction   │
           │   - Model too cheap   │
           │     for complex tasks │
           └───────────┬───────────┘
                       │
           ┌───────────▼───────────┐
           │   3. EXPERIMENT       │
           │   Propose change:     │
           │   - Modified persona  │
           │   - New routing rule  │
           │   - Different model   │
           │   Save as experiment  │
           │   with ID + baseline  │
           └───────────┬───────────┘
                       │
           ┌───────────▼───────────┐
           │   4. MEASURE          │
           │   Run N tasks with    │
           │   the change. Compare │
           │   metrics to baseline │
           │   period. Statistical │
           │   significance check. │
           └───────────┬───────────┘
                       │
           ┌───────────▼───────────┐
           │   5. RATCHET          │
           │   Improved? KEEP.     │
           │   Worse? REVERT.      │
           │   Inconclusive? Run   │
           │   more tasks.         │
           │   Log to experiment   │
           │   archive.            │
           └───────────┬───────────┘
                       │
                       └──────→ back to OBSERVE
```

**Fixed eval metric:** Composite score = `0.4 * quality_score + 0.3 *
(1 - normalized_cost) + 0.2 * (1 - normalized_time) + 0.1 * success_rate`

**Ratchet rule:** New configuration is adopted only if composite score improves
by >= 2% over baseline with >= 5 tasks evaluated. Otherwise revert.

**Safety:** Experiments run in shadow mode first (both old and new config run,
only old config's output is used). After shadow validation, switch to new config.

## Metrics to Track

| Metric | Source | Granularity |
|--------|--------|-------------|
| Task success rate | `events` table (completed/failed) | Per agent, per task type, per model |
| Quality score | P1 verification gate output | Per task |
| Cost per task (USD) | `budget_log` table | Per task, per agent |
| Time to completion | `sessions.spawned_at` to completion event | Per task |
| Rework cycles | Task state transitions (review -> running count) | Per task |
| CEO satisfaction | Manual feedback on completed tasks (thumbs up/down) | Per task |
| Memory hit rate | Memory files injected vs task outcome | Per memory file |
| Routing accuracy | Agent assigned vs optimal agent (retrospective analysis) | Per task type |

## Implementation Plan

### Phase D1: Experiment Infrastructure (Week 1-2)
**Goal:** Ability to define, run, and evaluate configuration experiments.

Files:
- `src/core/experiments.ts` — Experiment CRUD: create, list, get, update, archive
- `src/core/experiment-runner.ts` — Shadow execution engine
- `config/experiments.yaml` — Active experiment definitions
- DB: `experiments` table (id, type, hypothesis, config_diff, baseline_metrics, experiment_metrics, status, created_at, resolved_at)

### Phase D2: Metrics Aggregation (Week 2-3)
**Goal:** Compute all optimization metrics from existing data.

Files:
- `src/core/metrics-aggregator.ts` — Aggregate quality, cost, time, success rate per (agent, task-type, model, period)
- `src/api/routes.ts` — Extend `GET /api/v1/metrics` with per-agent, per-type breakdowns
- `apps/web/src/components/pulse/optimization-dashboard.tsx` — Visualize experiments and metrics

### Phase D3: Persona Optimizer (Week 3-4)
**Goal:** Automatically propose and test persona improvements.

Files:
- `src/core/persona-optimizer.ts` — Analyze retrospectives + quality scores, propose persona edits (TextGrad-style: use review feedback as gradients)
- `personas/experiments/` — Experimental persona variants (git-tracked)
- Standing duty in `config/duties.yaml`: `persona-optimization` (weekly, CEO Office)

### Phase D4: Routing Optimizer (Week 4-5)
**Goal:** Automatically tune routing rules based on outcome data.

Files:
- `src/core/routing-optimizer.ts` — OPRO-style: describe current routing performance to LLM, ask for improved rules, evaluate
- `config/routing.yaml` — Auto-updated with optimizer output (git-tracked, CEO approval gate)

### Phase D5: Model Selection Optimizer (Week 5-6)
**Goal:** Find Pareto-optimal model tier per task type.

Files:
- `src/core/model-optimizer.ts` — A/B assignment, Pareto analysis, recommendation engine
- `config/model-routing.yaml` — Auto-updated model selection rules

### Phase D6: Memory Optimizer (Week 6-7)
**Goal:** Voyager-style skill library optimization.

Files:
- `src/core/memory-optimizer.ts` — Correlate memory injection with outcomes, score memory files, prune/promote
- Extends existing `src/core/memory-consolidation.ts`

### Phase D7: Meta-Dashboard (Week 7-8)
**Goal:** CEO visibility into optimization progress.

Files:
- `apps/web/src/app/optimization/page.tsx` — Experiment list, active A/B tests, metric trends
- `apps/web/src/components/optimization/experiment-card.tsx` — Per-experiment detail with before/after metrics

## Existing Building Blocks

ANC already has the foundation:

| Building Block | Location | Role in Optimization |
|---------------|----------|---------------------|
| Retrospectives | Auto-generated after each task | Outcome data — what worked, what didn't |
| Quality scores | P1 verification gate (`src/core/review.ts`) | Quality metric for the composite score |
| Cost ingestion | Transcript parsing (`src/core/pricing.ts`) | Cost metric per task |
| Task events | `task_events` table | Full behavioral trace |
| Persona tuner | `src/core/persona-tuner.ts` | Structural optimization (scope overlap/gap) |
| Memory consolidation | `src/core/memory-consolidation.ts` | Knowledge optimization (prune stale) |
| Standing duties | `src/hooks/on-duties.ts` + `config/duties.yaml` | Scheduling mechanism for optimization runs |
| Budget series | `GET /api/v1/config/budget/series` | Cost trend data |
| Performance metrics | `GET /api/v1/metrics` | Aggregated performance data |

**The missing piece:** A feedback loop (the optimizer) that reads these signals
and writes configuration changes. That is Phase D.
