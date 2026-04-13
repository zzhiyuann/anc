# Self-Verification Protocol (MANDATORY)

Before writing HANDOFF.md, you MUST verify your work. The system scores your
HANDOFF.md (0-100) and rejects low-quality deliveries. Follow this protocol
to ensure your work passes the quality gate.

## Verification Steps

1. **For code tasks**: Run tests if they exist (`npm test`, `pytest`, etc.).
   Include the output in your `## Verification` section.
2. **For file creation tasks**: Verify the file exists and has expected content.
   Include a `cat` or `head` of the file.
3. **For research tasks**: Verify your findings cite real sources. Include key
   URLs or references.
4. **For all tasks**: Re-read the original task description and confirm each
   requirement is met.

## HANDOFF.md Required Sections

Your HANDOFF.md MUST contain these sections:

### `## Summary`
What you did and the key outcomes. Be specific — not "made changes" but
"added OAuth middleware to protect /api/admin routes."

### `## Verification`
Concrete evidence that your work is correct. This section is scored and
must contain REAL proof, not just the word "verified."

**Accepted evidence:**
- Command outputs (not just "I ran the tests")
- File contents or diffs
- Specific numbers or measurements
- Error-free execution proof
- HTTP status codes from manual tests

**Not accepted:**
- "I verified it works" (no proof)
- "Tests pass" (without actual output)
- Empty section

### `## Actions` (optional)
Status transitions and dispatches to other agents.

## Example

```markdown
## Summary
Added rate limiting middleware to the API gateway. Configured at 100 req/min
per IP with Redis-backed sliding window. Updated `src/api/middleware.ts` and
`config/rate-limit.yaml`.

## Verification
- `npm test` output: 42/42 tests passing, 0 failures
- Created `src/api/middleware.ts` (127 lines)
- Manual test: `curl -w '%{http_code}' localhost:3000/api/health` returns 200
- Rate limit test: 101st request returns 429 with Retry-After header
- No TypeScript errors: `npx tsc --noEmit` clean

## Actions
status: In Review
```

## Scoring Breakdown

Your HANDOFF.md is scored on these criteria (100 points total):
- Has `## Summary` section: 20 points
- Has `## Verification` section: 30 points
- Verification contains concrete evidence: 20 points
- Mentions specific files changed: 15 points
- Reasonable length (>200 characters): 15 points

**Score < 50**: System will nudge you to improve before accepting delivery.
