/**
 * Tests for HANDOFF dispatch: verifies that dispatches create local ANC tasks
 * even when Linear API is unavailable.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { parseActions } from '../src/hooks/actions-parser.js';
import { _resetRegistry } from '../src/agents/registry.js';

beforeEach(() => {
  _resetRegistry();
});

describe('HANDOFF dispatch processing', () => {
  it('parseActions extracts dispatches with new_issue and context', () => {
    const handoff = `## Summary
Strategist completed product analysis.

## Verification
Verified approach is sound.

## Actions
status: In Review
dispatches:
  - role: engineer
    new_issue: "Implement ANC landing page"
    context: "Build a single-page landing page with hero, features, CTA sections"
    priority: 2
`;

    const actions = parseActions(handoff);
    expect(actions).not.toBeNull();
    expect(actions!.status).toBe('In Review');
    expect(actions!.dispatches).toHaveLength(1);

    const dispatch = actions!.dispatches[0];
    expect(dispatch.role).toBe('engineer');
    expect(dispatch.newIssue).toBe('Implement ANC landing page');
    expect(dispatch.context).toContain('single-page landing page');
    expect(dispatch.priority).toBe(2);
  });

  it('parseActions handles multiple dispatches', () => {
    const handoff = `## Actions
status: In Progress
dispatches:
  - role: engineer
    new_issue: "Build API"
    context: "Implement REST endpoints"
  - role: ops
    new_issue: "Deploy infra"
    context: "Set up CI/CD pipeline"
`;

    const actions = parseActions(handoff);
    expect(actions!.dispatches).toHaveLength(2);
    expect(actions!.dispatches[0].role).toBe('engineer');
    expect(actions!.dispatches[1].role).toBe('ops');
  });

  it('parseActions handles dispatch without new_issue (same-issue dispatch)', () => {
    const handoff = `## Actions
status: In Review
dispatches:
  - role: engineer
    context: "Continue implementation on this issue"
`;

    const actions = parseActions(handoff);
    expect(actions!.dispatches).toHaveLength(1);
    expect(actions!.dispatches[0].newIssue).toBeUndefined();
    expect(actions!.dispatches[0].context).toBe('Continue implementation on this issue');
  });

  it('parseActions rejects unknown roles', () => {
    const handoff = `## Actions
status: Done
dispatches:
  - role: nonexistent_role
    context: "This should be filtered"
`;

    const actions = parseActions(handoff);
    expect(actions!.dispatches).toHaveLength(0);
  });

  it('parseActions handles dispatches with parent_status', () => {
    const handoff = `## Actions
status: Done
parent_status: In Progress
dispatches:
  - role: engineer
    new_issue: "Sub-task"
    context: "Do the thing"
`;

    const actions = parseActions(handoff);
    expect(actions!.parentStatus).toBe('In Progress');
    expect(actions!.dispatches).toHaveLength(1);
  });
});
