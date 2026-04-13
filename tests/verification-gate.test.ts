import { describe, it, expect } from 'vitest';
import { computeQualityScore, detectTaskType } from '../src/hooks/handoff-processor.js';

describe('computeQualityScore', () => {
  it('returns 0 for empty handoff', () => {
    const score = computeQualityScore('');
    expect(score.total).toBe(0);
    expect(score.breakdown.hasSummary).toBe(0);
    expect(score.breakdown.hasVerification).toBe(0);
  });

  it('scores a complete high-quality handoff at 100', () => {
    const handoff = `## Summary
Added rate limiting middleware to the API gateway. Configured at 100 req/min
per IP with Redis-backed sliding window. Updated src/api/middleware.ts and
config/rate-limit.yaml.

## Verification
- \`npm test\` output: 42 tests passing, 0 failures
- Created \`src/api/middleware.ts\` (127 lines)
- Manual test: \`curl localhost:3000/api/health\` returns 200
`;
    const score = computeQualityScore(handoff);
    expect(score.total).toBe(100);
    expect(score.breakdown.hasSummary).toBe(20);
    expect(score.breakdown.hasVerification).toBe(30);
    expect(score.breakdown.verificationEvidence).toBe(20);
    expect(score.breakdown.mentionsFiles).toBe(15);
    expect(score.breakdown.reasonableLength).toBe(15);
  });

  it('gives 20pts for summary-only handoff', () => {
    const handoff = `## Summary
Did some work on the feature. This is a long enough handoff to pass the length check and have enough content.
More details about the changes. Added some things here and there.
`;
    const score = computeQualityScore(handoff);
    expect(score.breakdown.hasSummary).toBe(20);
    expect(score.breakdown.hasVerification).toBe(0);
    expect(score.breakdown.verificationEvidence).toBe(0);
  });

  it('gives 30pts for verification section without evidence', () => {
    const handoff = `## Summary
Made changes.

## Verification
I verified that everything works correctly and the feature is complete.
The implementation is solid and well-tested. All requirements are met.
More text to reach reasonable length threshold for the scoring system.
`;
    const score = computeQualityScore(handoff);
    expect(score.breakdown.hasVerification).toBe(30);
    expect(score.breakdown.verificationEvidence).toBe(0);
  });

  it('gives 20pts for verification with concrete command output', () => {
    const handoff = `## Summary
Fixed the bug.

## Verification
- \`npm test\` output: 15 tests passing
- All green, no errors
This is enough content to be a reasonable handoff document for scoring.
`;
    const score = computeQualityScore(handoff);
    expect(score.breakdown.hasVerification).toBe(30);
    expect(score.breakdown.verificationEvidence).toBe(20);
  });

  it('gives 15pts for mentioning file paths', () => {
    const handoff = `## Summary
Updated src/hooks/handler.ts with new logic. This is a description of changes.
Enough content here to make this a reasonable length handoff document overall.
`;
    const score = computeQualityScore(handoff);
    expect(score.breakdown.mentionsFiles).toBe(15);
  });

  it('gives 15pts for reasonable length (>200 chars)', () => {
    const handoff = 'x'.repeat(201);
    const score = computeQualityScore(handoff);
    expect(score.breakdown.reasonableLength).toBe(15);
  });

  it('gives 0 for length under 200 chars', () => {
    const handoff = 'short';
    const score = computeQualityScore(handoff);
    expect(score.breakdown.reasonableLength).toBe(0);
  });

  it('scores below 50 for a lazy handoff', () => {
    const handoff = `Done. Everything works.`;
    const score = computeQualityScore(handoff);
    expect(score.total).toBeLessThan(50);
  });

  it('detects numbers as verification evidence', () => {
    const handoff = `## Summary
Fixed tests.

## Verification
All 42 tests passing with 0 errors. Build succeeds. Extra text to make length.
More content for scoring purposes. This is additional verification detail.
`;
    const score = computeQualityScore(handoff);
    expect(score.breakdown.verificationEvidence).toBe(20);
  });
});

describe('quality gates — required sections', () => {
  it('hasSummarySection gate detects missing ## Summary', () => {
    // The gate is tested indirectly through computeQualityScore
    const noSummary = `# HANDOFF\nDid stuff.\n## Verification\nWorks.`;
    const withSummary = `## Summary\nDid stuff.\n## Verification\nWorks.`;
    expect(computeQualityScore(noSummary).breakdown.hasSummary).toBe(0);
    expect(computeQualityScore(withSummary).breakdown.hasSummary).toBe(20);
  });

  it('hasVerificationSection gate detects missing ## Verification', () => {
    const noVerif = `## Summary\nDid stuff.\nDone.`;
    const withVerif = `## Summary\nDid stuff.\n## Verification\nTested.`;
    expect(computeQualityScore(noVerif).breakdown.hasVerification).toBe(0);
    expect(computeQualityScore(withVerif).breakdown.hasVerification).toBe(30);
  });
});

describe('detectTaskType', () => {
  it('detects trivial tasks', () => {
    expect(detectTaskType('fix typo in readme', [])).toBe('trivial');
    expect(detectTaskType('bump version', [])).toBe('trivial');
    expect(detectTaskType('lint cleanup', [])).toBe('trivial');
  });

  it('detects strategy tasks', () => {
    expect(detectTaskType('pricing strategy review', [])).toBe('strategy');
    expect(detectTaskType('roadmap planning', [])).toBe('strategy');
    expect(detectTaskType('regular task', ['strategy'])).toBe('strategy');
  });

  it('detects research tasks', () => {
    expect(detectTaskType('literature survey on RAG', [])).toBe('research');
    expect(detectTaskType('benchmark analysis', [])).toBe('research');
    expect(detectTaskType('regular task', ['research'])).toBe('research');
  });

  it('defaults to code', () => {
    expect(detectTaskType('implement auth module', [])).toBe('code');
    expect(detectTaskType('add API endpoint', [])).toBe('code');
  });
});
