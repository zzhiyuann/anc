import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  trackSession, untrackSession, getActiveSessions, getIdleSessions,
  getSuspendedSessions, getSessionForIssue, hasCapacity,
  markIdle, markActiveFromIdle, markSuspended, markResumed,
  pickToEvict, activeCount, isIssueActive, isIssueIdle,
  isIssueSuspended, getHealthStatus, _resetHealth,
} from '../src/runtime/health.js';
import { _resetRegistry } from '../src/agents/registry.js';

beforeEach(() => {
  _resetHealth();
  _resetRegistry();
});

function track(overrides: Partial<Parameters<typeof trackSession>[0]> = {}) {
  const defaults = { role: 'engineer', issueKey: 'RYA-1', tmuxSession: 'anc-engineer-RYA-1', spawnedAt: Date.now(), priority: 3, ceoAssigned: false };
  trackSession({ ...defaults, ...overrides });
}

describe('Three-State Lifecycle', () => {
  it('tracks active sessions', () => {
    track({ issueKey: 'RYA-1' });
    track({ issueKey: 'RYA-2', tmuxSession: 'anc-engineer-RYA-2' });
    expect(getActiveSessions('engineer')).toHaveLength(2);
    expect(activeCount('engineer')).toBe(2);
  });

  it('active → idle transition', () => {
    track({ issueKey: 'RYA-1' });
    expect(isIssueActive('RYA-1')).toBe(true);
    expect(markIdle('RYA-1')).toBe(true);
    expect(isIssueIdle('RYA-1')).toBe(true);
    expect(isIssueActive('RYA-1')).toBe(false);
    expect(getActiveSessions('engineer')).toHaveLength(0);
    expect(getIdleSessions('engineer')).toHaveLength(1);
  });

  it('idle → active transition (follow-up)', () => {
    track({ issueKey: 'RYA-1' });
    markIdle('RYA-1');
    expect(markActiveFromIdle('RYA-1', 'anc-engineer-RYA-1-v2')).toBe(true);
    expect(isIssueActive('RYA-1')).toBe(true);
    expect(getSessionForIssue('RYA-1')?.tmuxSession).toBe('anc-engineer-RYA-1-v2');
    // handoffProcessed should reset
    expect(getSessionForIssue('RYA-1')?.handoffProcessed).toBe(false);
  });

  it('active → suspended transition', () => {
    track({ issueKey: 'RYA-1' });
    expect(markSuspended('RYA-1')).toBe(true);
    expect(isIssueSuspended('RYA-1')).toBe(true);
    expect(getSuspendedSessions('engineer')).toHaveLength(1);
  });

  it('suspended → active transition (resume)', () => {
    track({ issueKey: 'RYA-1' });
    markSuspended('RYA-1');
    expect(markResumed('RYA-1', 'anc-engineer-RYA-1-v2')).toBe(true);
    expect(isIssueActive('RYA-1')).toBe(true);
    expect(getSessionForIssue('RYA-1')?.useContinue).toBe(true);
  });

  it('idle sessions set useContinue=true', () => {
    track({ issueKey: 'RYA-1' });
    markIdle('RYA-1');
    expect(getSessionForIssue('RYA-1')?.useContinue).toBe(true);
  });
});

describe('Capacity (idle does NOT count)', () => {
  it('only active sessions count against maxConcurrency', () => {
    track({ issueKey: 'RYA-1' });
    track({ issueKey: 'RYA-2', tmuxSession: 't2' });
    expect(hasCapacity('engineer')).toBe(true);  // 2/3

    track({ issueKey: 'RYA-3', tmuxSession: 't3' });
    expect(hasCapacity('engineer')).toBe(false);  // 3/3

    // Mark one idle → capacity opens up
    markIdle('RYA-1');
    expect(hasCapacity('engineer')).toBe(true);  // 2 active / 3
  });

  it('suspended sessions do not count', () => {
    track({ issueKey: 'RYA-1' });
    track({ issueKey: 'RYA-2', tmuxSession: 't2' });
    track({ issueKey: 'RYA-3', tmuxSession: 't3' });
    expect(hasCapacity('engineer')).toBe(false);

    markSuspended('RYA-3');
    expect(hasCapacity('engineer')).toBe(true);
  });
});

describe('Eviction Priority', () => {
  it('evicts idle before active', () => {
    track({ issueKey: 'RYA-1', priority: 1 });  // high priority active
    track({ issueKey: 'RYA-2', tmuxSession: 't2', priority: 4 });
    markIdle('RYA-2');  // idle

    const victim = pickToEvict('engineer');
    expect(victim?.issueKey).toBe('RYA-2');  // idle evicted first
  });

  it('prefers idle with handoffProcessed', () => {
    track({ issueKey: 'RYA-1' });
    track({ issueKey: 'RYA-2', tmuxSession: 't2' });
    markIdle('RYA-1');
    markIdle('RYA-2');

    // Manually set handoffProcessed
    const s2 = getSessionForIssue('RYA-2');
    if (s2) s2.handoffProcessed = true;

    const victim = pickToEvict('engineer');
    expect(victim?.issueKey).toBe('RYA-2');  // handoff processed = fully done
  });

  it('never evicts CEO-assigned active', () => {
    track({ issueKey: 'RYA-1', priority: 4, ceoAssigned: true });
    const victim = pickToEvict('engineer');
    expect(victim).toBeNull();
  });

  it('returns null when no evictable sessions', () => {
    const victim = pickToEvict('engineer');
    expect(victim).toBeNull();
  });
});

describe('Health Status', () => {
  it('reports all three states', () => {
    track({ issueKey: 'RYA-1' });
    track({ issueKey: 'RYA-2', tmuxSession: 't2' });
    track({ issueKey: 'RYA-3', tmuxSession: 't3' });
    markIdle('RYA-2');
    markSuspended('RYA-3');

    const status = getHealthStatus('engineer');
    expect(status.activeSessions).toBe(1);
    expect(status.idleSessions).toBe(1);
    expect(status.suspendedSessions).toBe(1);
    expect(status.maxConcurrency).toBe(3);
    expect(status.sessions).toHaveLength(3);
  });
});
