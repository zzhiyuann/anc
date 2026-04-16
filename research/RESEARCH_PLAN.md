# ANC Research Plan

## Paper: Organizational Design Patterns for Autonomous AI Agent Teams

### Target Venue
ICML 2026 (main conference)

### Core Thesis
Current AI coding agents are evaluated as isolated tools. But in practice, agents work in teams with organizational structures — memory, oversight, delegation. We formalize three organizational design patterns, propose SimCEO (a simulated human-CEO evaluation framework), and empirically demonstrate the effect of each pattern on agent team performance.

### Three Design Patterns Under Study

| # | Pattern | ANC Implementation | Ablation |
|---|---------|-------------------|----------|
| 1 | **Persistent Memory + Retrospectives** | 4-pass consolidation engine, layered storage, retro injection | none → flat memory → memory + retros |
| 2 | **Meta-Agent Oversight (CEO Office)** | Health monitor, circuit breaker, auto-recovery, briefings | disabled → enabled |
| 3 | **Configurable Delegation (Review Policy)** | 5-level strictness: strict/normal/lax/autonomous/peer-review | strict → normal → autonomous |

### Evaluation Methodology

#### SimCEO Framework
An LLM (Claude via `claude -p`) simulates a human CEO who:
1. Issues tasks (from GitHub contributor streams)
2. Provides mid-task feedback (follow-up comments)
3. Reviews completed work
4. Rates satisfaction (1-5 scale, PULSE-aligned)

**Validation**: Real human CEO rates 30 calibration tasks. Pearson ρ between SimCEO and human ratings validates the framework. Target: ρ ≥ 0.6.

**Additional annotators**: 2-3 external annotators rate the same 30 tasks for inter-rater agreement (Krippendorff's α).

#### Data Sources
1. **Primary**: GitHub per-contributor issue streams from 5 OSS repos (ruff, pydantic, fastapi, langchain, next.js)
   - Provides longitudinal task sequences that naturally test memory accumulation
   - Real issues, objective complexity, diverse task types
2. **Calibration**: 30 hand-crafted tasks (5 low / 15 medium / 10 high complexity)

#### Ablation Conditions (7 total)

| Condition | Memory | CEO Office | Review Policy |
|-----------|--------|-----------|---------------|
| vanilla_baseline | none | off | autonomous |
| anc_no_memory | none | on | normal |
| anc_memory_no_retros | flat | on | normal |
| anc_full | full | on | normal |
| anc_no_oversight | full | off | normal |
| anc_strict_review | full | on | strict |
| anc_autonomous_review | full | on | autonomous |

#### Metrics

| Metric | Source | Notes |
|--------|-------|-------|
| SimCEO Satisfaction (1-5) | SimCEO | Primary metric, PULSE-aligned |
| Task Completion (0/1) | SimCEO | Binary |
| Code Quality (1-5) | SimCEO | Separate from satisfaction |
| Communication Quality (1-5) | SimCEO | How well agent reported progress |
| Autonomy Score (1-5) | SimCEO | How little CEO intervention needed |
| CEO Interventions (count) | System log | Lower = better |
| Recovery Rate | System log | % tasks needing recovery |
| Duration (seconds) | System log | Wall clock time |
| Cost (USD) | Budget tracker | API cost per task |
| Memory Utilization | System log | Retros cited in later tasks |

### Baselines
- **Vanilla Claude Code**: Raw `claude -p` with no orchestration
- **ANC minus each design**: Ablation removes one design at a time

### Statistical Analysis
- **Effect size**: Δ_augment (PULSE-style PPI estimator) for each design pattern
- **Significance**: Bootstrap permutation test, α = 0.05
- **Confidence intervals**: 95% CI using augmented estimator (reduces CI width ~40% vs naive)

### Timeline

| Phase | Task | Status |
|-------|------|--------|
| 1 | Evaluation harness code | ✅ Done |
| 2 | SimCEO validation (claude -p) | ✅ Verified |
| 3 | Calibration tasks generated | ✅ 30 tasks |
| 4 | GitHub data pipeline | ✅ Done (198 tasks, 5 repos) |
| 5 | SimCEO calibration ratings | ✅ Done (30 tasks rated) |
| 6 | Human CEO rates 30 tasks | ✅ Done |
| 7 | SimCEO validation (Pearson ρ) | ✅ Done (ρ=0.937, MAE=0.367) |
| 8 | Full ablation experiments | 🔄 Ready (eval harness fixed, server auto-start) |
| 9 | Analysis + report generation | ⏳ After 8 |
| 10 | Paper writing (LaTeX) | ⏳ After 9 |
| 11 | External annotator ratings | ⏳ Parallel with 10 |
| 12 | Revision + submission | ⏳ After 10+11 |

### Related Work (Key Papers)

1. Chen et al. "PULSE: How Can We Assess Human-Agent Interactions?" (2025) — ICML
2. Chen et al. "Completion ≠ Collaboration" (2025) — ACL Findings
3. Ji et al. "MultiAgentBench" (2025) — ACL
4. Wu et al. "AutoGen" (2024) — COLM
5. McAuley et al. "MemoryAgentBench" (2026) — ICLR
6. He et al. "MegaAgent" (2025) — ACL Findings
7. Amershi et al. "Guidelines for Human-AI Interaction" (2019) — CHI
8. Chen et al. "Code with Me or for Me?" (2026) — CHI

### Files

```
research/
├── eval/
│   ├── simceo.ts              # SimCEO core (rating + follow-up + experiment runner)
│   ├── simceo-validate.ts     # Human validation pipeline (generate/rate/compare)
│   ├── github-streams.ts      # GitHub per-contributor issue stream extractor
│   └── run-ablation.ts        # Full ablation orchestrator + analysis
├── data/
│   └── github/                # Extracted issue streams + task specs
├── results/
│   ├── validation/            # SimCEO calibration results
│   └── run_*/                 # Ablation experiment runs
├── paper/                     # LaTeX paper (when results are ready)
└── RESEARCH_PLAN.md           # This file
```
