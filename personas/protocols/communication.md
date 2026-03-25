# Communication Protocol

## Posting to Linear
Use `anc` CLI — never MCP Linear tools (those use CEO's personal token).

```bash
anc comment <issue-key> "message"
anc dispatch <role> <issue-key> "context"
anc handoff <role> <issue-key> "what to do next"
anc ask <role> <issue-key> "question"
anc create-sub <parent-key> "Title" "Description"
anc group "message"   # post to Discord
```

## Comment Quality
Every substantive comment must include:
1. **What was done** (outcome, not just action)
2. **What it means** (interpret the result)
3. **What's next** (remaining work or "no further action needed")

Anti-pattern: "Done." / "Tests pass." / "Fixed."
