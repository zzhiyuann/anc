import { describe, it, expect, beforeEach } from 'vitest';
import { parseActions, extractSummary } from '../src/hooks/actions-parser.js';
import { _resetRegistry } from '../src/agents/registry.js';

beforeEach(() => {
  _resetRegistry();
});

describe('parseActions', () => {
  it('returns null when no Actions section', () => {
    const handoff = '# HANDOFF\n## Summary\nDid stuff\n## Verification\nWorks';
    expect(parseActions(handoff)).toBeNull();
  });

  it('parses simple status-only actions', () => {
    const handoff = '## Summary\nDone\n## Actions\nstatus: Done';
    const result = parseActions(handoff);
    expect(result?.status).toBe('Done');
    expect(result?.dispatches).toHaveLength(0);
    expect(result?.delegate).toBeUndefined();
  });

  it('parses In Review status', () => {
    const handoff = '## Actions\nstatus: In Review';
    expect(parseActions(handoff)?.status).toBe('In Review');
  });

  it('parses In Progress with dispatches', () => {
    const handoff = `## Actions
status: In Progress
dispatches:
  - role: engineer
    context: "Fix the bug"
  - role: strategist
    context: "Review the approach"
delegate: engineer`;

    const result = parseActions(handoff);
    expect(result?.status).toBe('In Progress');
    expect(result?.dispatches).toHaveLength(2);
    expect(result?.dispatches[0].role).toBe('engineer');
    expect(result?.dispatches[0].context).toBe('Fix the bug');
    expect(result?.dispatches[1].role).toBe('strategist');
    expect(result?.delegate).toBe('engineer');
  });

  it('parses new_issue dispatches', () => {
    const handoff = `## Actions
status: In Progress
dispatches:
  - role: engineer
    new_issue: "Build the API"
    context: "Implement REST endpoints per spec"
    priority: 2`;

    const result = parseActions(handoff);
    expect(result?.dispatches[0].newIssue).toBe('Build the API');
    expect(result?.dispatches[0].priority).toBe(2);
  });

  it('parses parent_status', () => {
    const handoff = `## Actions
status: Done
parent_status: In Review`;

    const result = parseActions(handoff);
    expect(result?.status).toBe('Done');
    expect(result?.parentStatus).toBe('In Review');
  });

  it('handles quoted and unquoted values', () => {
    const handoff = `## Actions
status: In Review
delegate: "ops"`;

    const result = parseActions(handoff);
    expect(result?.delegate).toBe('ops');
  });

  it('skips invalid roles in dispatches', () => {
    const handoff = `## Actions
status: In Progress
dispatches:
  - role: engineer
    context: "valid"
  - role: nonexistent_role
    context: "invalid"`;

    const result = parseActions(handoff);
    expect(result?.dispatches).toHaveLength(1);
    expect(result?.dispatches[0].role).toBe('engineer');
  });

  it('defaults status to In Review when invalid', () => {
    const handoff = `## Actions
status: InvalidStatus`;

    const result = parseActions(handoff);
    expect(result?.status).toBe('In Review');
  });

  it('stops at next ## section', () => {
    const handoff = `## Actions
status: Done

## Some Other Section
This should not be parsed`;

    const result = parseActions(handoff);
    expect(result?.status).toBe('Done');
    expect(result?.dispatches).toHaveLength(0);
  });
});

describe('extractSummary', () => {
  it('returns everything before ## Actions', () => {
    const handoff = `# HANDOFF — ANC-1

## Summary
Did great things

## Verification
Works fine

## Actions
status: Done`;

    const summary = extractSummary(handoff);
    expect(summary).toContain('Did great things');
    expect(summary).toContain('Verification');
    expect(summary).not.toContain('status: Done');
    expect(summary).not.toContain('## Actions');
  });

  it('returns full content when no Actions block', () => {
    const handoff = '# HANDOFF\nJust a summary with no actions';
    expect(extractSummary(handoff)).toBe(handoff);
  });
});
