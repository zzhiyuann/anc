/**
 * Model router tests — task classification + model selection.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { selectModel, _resetOverrideCache, type TaskInput } from '../src/core/model-router.js';

function makeTask(overrides: Partial<TaskInput> = {}): TaskInput {
  return {
    title: 'Test task',
    description: null,
    priority: 3,
    source: 'system',
    parentTaskId: null,
    ...overrides,
  };
}

describe('selectModel', () => {
  beforeEach(() => {
    _resetOverrideCache();
  });

  // --- Opus routing ---

  it('routes priority 1 (Urgent) tasks to opus', () => {
    const decision = selectModel(makeTask({ priority: 1 }));
    expect(decision.model).toBe('opus');
    expect(decision.estimatedCostMultiplier).toBe(1.0);
  });

  it('routes priority 2 (CEO) tasks to opus', () => {
    const decision = selectModel(makeTask({ priority: 2 }));
    expect(decision.model).toBe('opus');
  });

  it('routes CEO-dispatched tasks to opus', () => {
    const decision = selectModel(makeTask({ source: 'ceo', parentTaskId: null }));
    expect(decision.model).toBe('opus');
    expect(decision.reason).toContain('CEO');
  });

  it('routes tasks with long descriptions to opus', () => {
    const longDesc = 'x'.repeat(201);
    const decision = selectModel(makeTask({ description: longDesc }));
    expect(decision.model).toBe('opus');
    expect(decision.reason).toContain('complex');
  });

  it('routes description exactly 200 chars to sonnet (not opus)', () => {
    const desc = 'x'.repeat(200);
    const decision = selectModel(makeTask({ description: desc }));
    expect(decision.model).toBe('sonnet');
  });

  // --- Sonnet routing ---

  it('routes standard priority 3 tasks to sonnet', () => {
    const decision = selectModel(makeTask({ priority: 3 }));
    expect(decision.model).toBe('sonnet');
    expect(decision.estimatedCostMultiplier).toBe(0.2);
  });

  it('routes priority 4 tasks to sonnet', () => {
    const decision = selectModel(makeTask({ priority: 4 }));
    expect(decision.model).toBe('sonnet');
  });

  // --- Haiku routing ---

  it('routes priority 5 (Low/Duty) tasks to haiku', () => {
    const decision = selectModel(makeTask({ priority: 5 }));
    expect(decision.model).toBe('haiku');
    expect(decision.estimatedCostMultiplier).toBe(0.07);
  });

  it('routes tasks with triage keyword to haiku', () => {
    const decision = selectModel(makeTask({ title: 'Triage incoming issues' }));
    expect(decision.model).toBe('haiku');
    expect(decision.reason).toContain('triage');
  });

  it('routes tasks with categorize keyword to haiku', () => {
    const decision = selectModel(makeTask({ description: 'Categorize these bugs by severity' }));
    expect(decision.model).toBe('haiku');
  });

  it('routes tasks with summarize keyword to haiku', () => {
    const decision = selectModel(makeTask({ title: 'Summarize sprint results' }));
    expect(decision.model).toBe('haiku');
  });

  it('routes tasks with format keyword to haiku', () => {
    const decision = selectModel(makeTask({ title: 'Format the changelog' }));
    expect(decision.model).toBe('haiku');
  });

  it('routes tasks with label keyword to haiku', () => {
    const decision = selectModel(makeTask({ title: 'Label new issues' }));
    expect(decision.model).toBe('haiku');
  });

  it('routes healthcheck source to haiku', () => {
    const decision = selectModel(makeTask({ source: 'healthcheck' }));
    expect(decision.model).toBe('haiku');
  });

  it('routes ops-pulse source to haiku', () => {
    const decision = selectModel(makeTask({ source: 'ops-pulse' }));
    expect(decision.model).toBe('haiku');
  });

  it('routes duty source to haiku', () => {
    const decision = selectModel(makeTask({ source: 'duty' }));
    expect(decision.model).toBe('haiku');
  });

  // --- Priority precedence ---

  it('high priority overrides haiku keywords', () => {
    const decision = selectModel(makeTask({ priority: 1, title: 'Triage critical outage' }));
    expect(decision.model).toBe('opus');
  });

  it('CEO source on priority 3 still routes to opus', () => {
    const decision = selectModel(makeTask({ priority: 3, source: 'ceo' }));
    expect(decision.model).toBe('opus');
  });

  // --- Cost multipliers ---

  it('returns correct cost multipliers', () => {
    expect(selectModel(makeTask({ priority: 1 })).estimatedCostMultiplier).toBe(1.0);
    expect(selectModel(makeTask({ priority: 3 })).estimatedCostMultiplier).toBe(0.2);
    expect(selectModel(makeTask({ priority: 5 })).estimatedCostMultiplier).toBe(0.07);
  });

  // --- Sub-task routing ---

  it('sub-tasks (with parentTaskId) follow normal priority rules', () => {
    const decision = selectModel(makeTask({ parentTaskId: 'parent-123', priority: 3 }));
    expect(decision.model).toBe('sonnet');
  });
});
