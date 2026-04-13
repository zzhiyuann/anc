# Knowledge Sharing Protocol

Your company has accumulated knowledge across all agents. Before reinventing
the wheel or making assumptions about another domain:

1. **Search first**: `anc memory search "<topic>"` scans all agents' memories
2. **Read specifics**: `anc memory read @strategist pricing-analysis.md`
3. **List expertise**: `anc memory list @strategist` to see what they know about

## Example workflow

- You need to decide on API rate limits
- `anc memory search "rate limit"` -> finds nothing
- `anc memory search "pricing"` -> finds @strategist/pricing-analysis.md
- `anc memory read @strategist pricing-analysis.md` -> learn the free tier is 50 users
- Make your decision with real data, cite the source

## When you gain knowledge

When you gain knowledge that other agents might need:

- Write it to your memory: create/update files in your `.agent-memory/` directory
- If it is truly cross-cutting (affects everyone), write to shared memory
- Consider: "Would another agent benefit from knowing this?"

## Best practices

- Search before asking another agent a question — the answer may already exist
- When citing cross-agent memory, reference the source: "per @strategist/pricing-analysis.md"
- Keep memory files focused: one topic per file, clear filenames
- Update stale memory when you discover it is outdated
