# Memory Systems Research -- SOTA Analysis

> **Date**: 2026-04-13
> **Purpose**: Survey state-of-the-art open-source agent memory systems to inform ANC Phase 2 memory architecture.

## Executive Summary

ANC's file-based layered memory is a strong foundation -- Letta's research shows filesystem approaches can outperform specialized memory tools (74% vs 68.5% on LoCoMo). However, ANC lacks three capabilities that every top system has converged on:

1. **Adopt structured fact extraction + deduplication** -- Every top system (Mem0, Hindsight, Zep) extracts discrete facts from conversations rather than storing raw text. ANC should add an LLM-powered extraction step when agents write memory, producing structured `{fact, entities, timestamp, confidence}` records alongside the markdown.

2. **Add temporal validity tracking** -- Zep's bi-temporal model (when a fact became true, when it was superseded) solves the stale-memory problem ANC will hit at scale. Implement validity windows in frontmatter metadata.

3. **Implement automatic consolidation with forgetting** -- ANC has no mechanism to prune or merge memories. Add a periodic "sleep-time" consolidation pass that deduplicates, resolves contradictions, and decays low-importance memories.

4. **Build multi-strategy retrieval** -- ANC's substring search will not scale. Add BM25 keyword search as the minimum viable upgrade (no vector DB needed), with optional semantic search later.

5. **Enable agent self-reflection on memory** -- Letta and Hindsight let agents decide what to remember and actively rewrite their own memory blocks. ANC agents should have explicit `memory_write` and `memory_forget` tools.

---

## Systems Reviewed

### 1. Mem0 (~52K stars)
**URL**: https://github.com/mem0ai/mem0

- **Architecture**: Vector store + optional knowledge graph (Mem0g). 19 vector backends supported (Qdrant, Chroma, PGVector, FAISS, etc.). Graph features require Pro tier ($249/mo) for hosted, but open-source supports Neo4j.
- **Retrieval**: Scope-based (user/agent/session/org) with multi-pass reranking (Cohere, HuggingFace, cross-encoder). Metadata filtering by tags and time ranges.
- **Consolidation**: Entity extraction -> relation generation -> conflict detection -> deduplication pipeline on every write. No automatic decay/forgetting.
- **Layers**: Episodic + semantic + procedural (v1.0.0). Scopes compose hierarchically: user > session > raw history.
- **Cross-agent**: Actor-aware memory tagging (June 2025) distinguishes user-stated facts from agent inferences. Prevents one agent's guess becoming another's truth.
- **Self-reflection**: Automatic extraction, not agent-directed. Agent does not decide what to remember.
- **Benchmarks**: 66.9% accuracy, 1.44s p95 latency, ~1,800 tokens/query (vs full-context: 72.9% accuracy, 17.12s, ~26K tokens).

**What ANC should steal**: The 4-scope model (user/agent/session/org) maps perfectly to ANC's existing per-role + shared structure. The conflict detection + deduplication pipeline is the highest-impact feature ANC lacks. Actor-aware tagging for multi-agent memory sharing.

---

### 2. Letta (formerly MemGPT) (~21K stars)
**URL**: https://github.com/letta-ai/letta

- **Architecture**: OS-inspired 3-tier memory. Core Memory (always in context, agent-editable blocks with labels + descriptions + char limits), Recall Memory (searchable conversation history, auto-persisted), Archival Memory (long-term vector/graph store queried via tools).
- **Retrieval**: Agents actively manage what stays in core vs gets archived. The agent decides relevance via tool calls (`core_memory_replace`, `archival_memory_insert`, `archival_memory_search`).
- **Consolidation**: Recursive summarization of evicted messages. "Sleep-time compute" -- async background agents refine memory during idle periods.
- **Layers**: Core (RAM) / Recall (disk cache) / Archival (cold storage). Each block has a label, description, value, and character limit.
- **Cross-agent**: Conversations API enables shared memory across parallel interactions.
- **Self-reflection**: **Yes -- this is Letta's key differentiator.** Agents self-edit memory blocks using tools. The agent decides what to keep, update, or archive.

**Critical finding**: Letta's benchmark paper ("Is a Filesystem All You Need?") showed agents using `grep`, `search_files`, `open`, `close` on plain files achieved **74.0% on LoCoMo** -- beating Mem0g's 68.5%. Their conclusion: "Agent capability matters more than tool sophistication." Agents perform better with familiar filesystem operations than unfamiliar specialized memory APIs.

**What ANC should steal**: The 3-tier model (core/recall/archival) with character limits per block -- ANC already has layered memory with char caps, so this validates the approach. Sleep-time consolidation is brilliant: run a background agent to clean up memory between sessions. The filesystem benchmark validates ANC's file-based approach but argues for giving agents file-operation tools.

---

### 3. Zep / Graphiti (~24K stars for Graphiti)
**URL**: https://github.com/getzep/graphiti

- **Architecture**: Temporal knowledge graph with 3 subgraphs: Episode (raw input, non-lossy), Semantic Entity (deduplicated entities + edges), Community (clustered summaries). Uses Neo4j as graph backend.
- **Retrieval**: 3-step pipeline: Search (cosine similarity + BM25 + breadth-first graph traversal in parallel) -> Rerank (RRF + MMR + episode-mention frequency + graph distance + cross-encoder) -> Construct (format with validity ranges).
- **Consolidation**: Edge invalidation -- when new facts contradict old ones, the old edge gets an end-timestamp rather than being deleted. Communities undergo periodic map-reduce summarization. Historical accuracy preserved while prioritizing recent info.
- **Layers**: Episodic (raw events) -> Semantic (entities + relationships) -> Community (high-level summaries). Mirrors psychological episodic vs semantic memory.
- **Cross-agent**: Multi-agent support via shared graph; each agent's contributions are tracked.
- **Self-reflection**: Automatic extraction + LLM-based entity resolution. Not agent-directed.
- **Benchmarks**: 71.2% on LongMemEval (gpt-4o), 90% latency reduction vs full-context. Strongest on temporal reasoning and multi-session synthesis.

**Key innovation**: Bi-temporal model with 4 timestamps per fact: `t'_created`, `t'_expired` (transaction times) and `t_valid`, `t_invalid` (event validity). This lets you ask "what did we believe on March 1?" vs "what is actually true?"

**What ANC should steal**: Temporal validity windows in frontmatter (e.g., `valid_from: 2026-04-01`, `superseded_by: <filename>`). Edge invalidation instead of deletion -- never lose history, just mark it superseded. This is implementable with zero infrastructure changes in ANC's markdown files.

---

### 4. Hindsight (~9.1K stars, growing fast)
**URL**: https://github.com/vectorize-io/hindsight

- **Architecture**: 4 logical memory networks: World (objective facts), Bank (agent's own experiences, first-person), Observation (preference-neutral entity summaries), Opinion (subjective judgments with confidence scores).
- **Retrieval**: 4 parallel strategies -- semantic search, BM25 keyword, entity graph traversal, temporal filtering -- merged via reciprocal rank fusion + cross-encoder reranking.
- **Consolidation**: The `reflect` operation synthesizes new connections between existing memories, updates confidence scores on opinions as new evidence arrives.
- **Layers**: World/Bank/Observation/Opinion -- a unique 4-way split that distinguishes objective facts from agent beliefs.
- **Cross-agent**: Agent profiles (name, background, disposition) shape how memories are recalled and reflected upon.
- **Self-reflection**: **Yes** -- the `reflect` operation explicitly synthesizes beliefs from raw memories.
- **Benchmarks**: **91.4% on LongMemEval** (best in class), 89.61% on LoCoMo. With a 20B open-source model, achieves 83.6% -- outperforming full-context GPT-4o.

**What ANC should steal**: The 4-network distinction is powerful. ANC's `strategic/` layer maps to World, `domain/` to Bank, `project/` to Observation. ANC should add an Opinion layer -- agent beliefs and preferences that evolve over time with confidence scores. The `reflect` operation (periodic synthesis of raw memories into higher-order beliefs) is the single most impactful feature ANC could add.

---

### 5. Cognee (~12K stars)
**URL**: https://github.com/topoteretes/cognee

- **Architecture**: Knowledge graph + vector store with 38+ data source connectors. ECL pipeline: Extract -> Cognify (classify, chunk, extract entities/relationships, summarize, embed) -> Load.
- **Retrieval**: Combines time filters, graph traversal, and vector similarity. MCP server for direct agent access.
- **Consolidation**: Automated pipeline handles deduplication and relationship mapping during ingestion.
- **Layers**: Session memory (short-term working context) vs Permanent memory (long-term artifacts).
- **Cross-agent**: Shared knowledge graph accessible to all agents via API/MCP.
- **Self-reflection**: Automatic pipeline, not agent-directed.

**What ANC should steal**: The ECL pipeline concept -- a formalized ingestion pipeline that processes raw agent output into structured memory. ANC could implement a lightweight version: when an agent writes to memory, run a quick extraction pass that pulls entities and tags into frontmatter.

---

### 6. LangMem (~1.3K stars)
**URL**: Part of LangChain/LangGraph ecosystem

- **Architecture**: Flat key-value items with vector search. Tightly coupled to LangGraph's Long-term Memory Store.
- **Retrieval**: Single-strategy vector similarity only.
- **Consolidation**: Basic, no sophisticated merging.
- **Layers**: Semantic + episodic + procedural types, but implementation is basic compared to dedicated memory systems.
- **Notable**: Deep LangGraph lock-in. Development cadence has slowed.

**What ANC should steal**: Nothing significant -- ANC's current system is already more sophisticated.

---

### 7. mcp-memory-service
**URL**: https://github.com/doobidoo/mcp-memory-service

- **Architecture**: Knowledge graph with typed edges (causes, fixes, contradicts). PostgreSQL-backed. REST API with 15 endpoints.
- **Retrieval**: Semantic search with 5ms response time. Agent-ID header for auto-tagging.
- **Consolidation**: Autonomous consolidation that compresses old memories. LLM-based classification.
- **Cross-agent**: X-Agent-ID header for multi-agent memory attribution.
- **Notable**: MCP-native, designed for Claude. Web dashboard with D3.js graph visualization.

**What ANC should steal**: The typed-edge concept (causes/fixes/contradicts) for linking related memory files. MCP integration pattern for future Claude agent access.

---

## Recommended Architecture for ANC

### Phase 1: Enhance File-Based System (No new infrastructure)

ANC's file-based approach is validated by Letta's research. The goal is to add intelligence to the existing markdown files without requiring a vector DB or graph database.

```
~/.anc/agents/<role>/memory/
  strategic/          # Core beliefs, slow-changing (= Hindsight "World")
    identity.md       # Agent self-model
    principles.md     # Operating principles
  domain/             # Expertise, medium-pace (= Hindsight "Bank")
    typescript.md
    testing.md
  beliefs/            # NEW: Agent opinions + confidence (= Hindsight "Opinion")
    code-style.md     # confidence: 0.85, last_updated: 2026-04-13
    team-dynamics.md  # confidence: 0.60
  project/<slug>/     # Project working memory (= Hindsight "Observation")
    context.md
    decisions.md
  retrospectives/     # Completed task learnings
    task-123.md
~/.anc/shared-memory/
  glossary.md         # Cross-agent shared knowledge
  architecture.md
  conventions.md
```

**Frontmatter schema** (enhanced):
```yaml
---
importance: critical|high|normal|low
valid_from: 2026-04-01
superseded_by: null          # or filename of replacement
confidence: 0.85             # for beliefs layer
entities: [typescript, vitest, testing]  # extracted entities for search
last_consolidated: 2026-04-10
access_count: 12             # for importance decay
---
```

### Phase 2: Add Consolidation Engine

A lightweight consolidation pass that runs periodically (e.g., after every 5 completed tasks, or on a daily schedule):

1. **Deduplication**: Scan for memories with overlapping entities and high text similarity. Merge or link them.
2. **Conflict resolution**: Flag memories where the same entity has contradictory facts. Present to agent or auto-resolve by recency.
3. **Importance decay**: Reduce importance of memories not accessed in N days. Promote frequently-accessed low-importance memories.
4. **Summarization**: When a project layer exceeds its character cap, summarize older entries into a `_consolidated.md` file.
5. **Temporal invalidation**: Mark superseded facts rather than deleting them. Keep a `_history/` subdirectory for invalidated memories.

Implementation: A TypeScript function in `src/agents/consolidate.ts` that reads all memory files for a role, runs the above passes using the LLM, and writes back. Can be triggered by the bus event system (`memory:consolidate`).

### Phase 3: Better Retrieval (Still no vector DB)

Before adding embeddings, maximize what substring search can do:

1. **BM25 keyword search**: Add a lightweight BM25 implementation (e.g., `wink-bm25-text-search` npm package, ~5KB). Index all memory files. This alone will massively improve retrieval over substring matching.
2. **Entity index**: Maintain a `_index.json` per role mapping entities to filenames. Updated on every write. Enables instant entity-based lookup.
3. **Recency + access weighting**: Score results by `importance * recency * access_frequency`.
4. **Cross-reference links**: Support `[[filename]]` wiki-links in memory files. Build a link graph for traversal-based retrieval.

### Phase 4: Optional Embedding Layer (Future)

Only if Phase 2-3 prove insufficient:

- Use a local embedding model (e.g., `nomic-embed-text` via Ollama) to embed memory chunks.
- Store embeddings in a SQLite-backed vector index (e.g., `sqlite-vss`).
- Keep markdown files as the source of truth; embeddings are a derived index.
- This avoids the operational complexity of running Qdrant/Chroma while getting 80% of the benefit.

---

## Implementation Priority

### 1. Frontmatter metadata enhancement (1-2 days)
**Impact: High | Effort: Low**
Add `valid_from`, `superseded_by`, `entities`, `confidence`, `access_count` fields to memory frontmatter. Update `readMemory` to parse frontmatter and track access. This is the foundation everything else builds on.

### 2. Agent memory tools -- self-edit capability (2-3 days)
**Impact: High | Effort: Medium**
Give agents explicit `memory_write`, `memory_update`, `memory_invalidate` tools in their SDK. Let agents decide what to remember (like Letta), rather than only writing through the system. Add to `src/commands/sdk.ts`.

### 3. Entity extraction on write (1-2 days)
**Impact: Medium | Effort: Low**
When memory is written, run a quick LLM call to extract entities and add them to frontmatter. Build the entity index (`_index.json`). Enables entity-based retrieval without vector search.

### 4. Beliefs layer with confidence scores (1 day)
**Impact: Medium | Effort: Low**
Add `beliefs/` subdirectory to memory structure. Each belief has a confidence score that the agent can update. Enables Hindsight-style opinion tracking.

### 5. Consolidation engine (3-5 days)
**Impact: High | Effort: Medium-High**
Build `src/agents/consolidate.ts` with dedup, conflict detection, importance decay, and summarization. Hook into bus events. Run after task completion or on schedule.

### 6. BM25 search upgrade (1-2 days)
**Impact: Medium | Effort: Low**
Replace substring search with BM25. Add recency + importance weighting. Dramatic improvement in retrieval quality for near-zero complexity.

### 7. Temporal invalidation (1 day)
**Impact: Medium | Effort: Low**
Implement Zep-style "supersede, don't delete." When a memory is updated, move the old version to `_history/` with an end-timestamp. The current version gets `valid_from` set.

### 8. Actor-aware shared memory (1-2 days)
**Impact: Medium | Effort: Low**
Tag shared memory writes with the source agent role (like Mem0's actor-aware memory). Other agents can see who wrote what and weight accordingly.

---

## Key Takeaways

| Dimension | SOTA Leader | ANC Current | Gap |
|-----------|------------|-------------|-----|
| Storage | Mem0 (19 backends) | Markdown files | **Acceptable** -- Letta proves files work |
| Retrieval | Hindsight (4-strategy parallel) | Substring match | **Critical gap** -- add BM25 minimum |
| Consolidation | Zep (temporal invalidation) | None | **Critical gap** -- memories will rot |
| Self-reflection | Letta (agent self-edit) | System-only writes | **Important gap** -- agents should own their memory |
| Memory types | Hindsight (4 networks) | 4 layers (strategic/domain/project/retro) | **Close** -- add beliefs layer |
| Cross-agent | Mem0 (actor-aware) | Shared directory | **Moderate gap** -- add attribution |
| Benchmarks | Hindsight 91.4% LongMemEval | Not benchmarked | Establish baseline |

**Bottom line**: ANC's file-based architecture is validated by industry research. The biggest wins come not from adding infrastructure (vector DBs, graph DBs) but from adding intelligence to the existing files: structured extraction, temporal tracking, consolidation, and agent self-management of memory.
