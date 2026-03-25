import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  trackSession, untrackSession, getActiveSessions, getSuspendedSessions,
  getSessionForIssue, hasCapacity, markSuspended, markResumed,
  pickSessionToSuspend, activeCount, isIssueActive, isIssueSuspended,
  getHealthStatus, _resetHealth,
} from '../src/runtime/health.js';
import { _resetRegistry } from '../src/agents/registry.js';

// Mock sessionExists to avoid actual tmux calls
vi.mock('../src/runtime/runner.js', () => ({
  sessionExists: (name: string) => !name.includes('dead'),
}));

beforeEach(() => {
  _resetHealth();
  _resetRegistry();
});

describe('Session Lifecycle', () => {
  it('tracks active sessions', () => {
    trackSession({ role: 'engineer', issueKey: 'RYA-1', tmuxSession: 'anc-engineer-RYA-1', spawnedAt: Date.now(), priority: 3, ceoAssigned: false });
    trackSession({ role: 'engineer', issueKey: 'RYA-2', tmuxSession: 'anc-engineer-RYA-2', spawnedAt: Date.now(), priority: 2, ceoAssigned: false });

    expect(getActiveSessions('engineer')).toHaveLength(2);
    expect(activeCount('engineer')).toBe(2);
  });

  it('respects maxConcurrency', () => {
    // Default engineer maxConcurrency = 3
    trackSession({ role: 'engineer', issueKey: 'RYA-1', tmuxSession: 't1', spawnedAt: Date.now(), priority: 3, ceoAssigned: false });
    trackSession({ role: 'engineer', issueKey: 'RYA-2', tmuxSession: 't2', spawnedAt: Date.now(), priority: 3, ceoAssigned: false });
    expect(hasCapacity('engineer')).toBe(true);  // 2/3

    trackSession({ role: 'engineer', issueKey: 'RYA-3', tmuxSession: 't3', spawnedAt: Date.now(), priority: 3, ceoAssigned: false });
    expect(hasCapacity('engineer')).toBe(false);  // 3/3
  });

  it('suspends and resumes sessions', () => {
    trackSession({ role: 'engineer', issueKey: 'RYA-1', tmuxSession: 't1', spawnedAt: Date.now(), priority: 3, ceoAssigned: false });

    expect(markSuspended('RYA-1')).toBe(true);
    expect(getActiveSessions('engineer')).toHaveLength(0);
    expect(getSuspendedSessions('engineer')).toHaveLength(1);
    expect(isIssueSuspended('RYA-1')).toBe(true);

    expect(markResumed('RYA-1', 't1-resumed')).toBe(true);
    expect(getActiveSessions('engineer')).toHaveLength(1);
    expect(getSuspendedSessions('engineer')).toHaveLength(0);
    expect(getSessionForIssue('RYA-1')?.tmuxSession).toBe('t1-resumed');
  });

  it('picks lowest-priority session to suspend', () => {
    trackSession({ role: 'engineer', issueKey: 'RYA-1', tmuxSession: 'anc-engineer-RYA-1', spawnedAt: 1000, priority: 1, ceoAssigned: false });
    trackSession({ role: 'engineer', issueKey: 'RYA-2', tmuxSession: 'anc-engineer-RYA-2', spawnedAt: 2000, priority: 4, ceoAssigned: false });
    trackSession({ role: 'engineer', issueKey: 'RYA-3', tmuxSession: 'anc-engineer-RYA-3', spawnedAt: 3000, priority: 2, ceoAssigned: false });

    const victim = pickSessionToSuspend('engineer');
    expect(victim?.issueKey).toBe('RYA-2');  // priority 4 = lowest priority
  });

  it('never suspends CEO-assigned sessions', () => {
    trackSession({ role: 'engineer', issueKey: 'RYA-1', tmuxSession: 'anc-engineer-RYA-1', spawnedAt: 1000, priority: 4, ceoAssigned: true });
    trackSession({ role: 'engineer', issueKey: 'RYA-2', tmuxSession: 'anc-engineer-RYA-2', spawnedAt: 2000, priority: 1, ceoAssigned: false });

    const victim = pickSessionToSuspend('engineer');
    // RYA-1 has lower priority but is CEO-assigned, so RYA-2 is picked
    expect(victim?.issueKey).toBe('RYA-2');
  });

  it('returns null when all sessions are CEO-assigned', () => {
    trackSession({ role: 'engineer', issueKey: 'RYA-1', tmuxSession: 'anc-engineer-RYA-1', spawnedAt: 1000, priority: 4, ceoAssigned: true });
    const victim = pickSessionToSuspend('engineer');
    expect(victim).toBeNull();
  });

  it('untrack removes from all state', () => {
    trackSession({ role: 'engineer', issueKey: 'RYA-1', tmuxSession: 't1', spawnedAt: Date.now(), priority: 3, ceoAssigned: false });
    untrackSession('RYA-1');
    expect(getSessionForIssue('RYA-1')).toBeUndefined();
    expect(getActiveSessions('engineer')).toHaveLength(0);
  });

  it('getHealthStatus shows all states', () => {
    trackSession({ role: 'engineer', issueKey: 'RYA-1', tmuxSession: 'anc-engineer-RYA-1', spawnedAt: Date.now(), priority: 3, ceoAssigned: false });
    trackSession({ role: 'engineer', issueKey: 'RYA-2', tmuxSession: 'anc-engineer-RYA-2', spawnedAt: Date.now(), priority: 2, ceoAssigned: false });
    markSuspended('RYA-2');

    const status = getHealthStatus('engineer');
    expect(status.activeSessions).toBe(1);
    expect(status.suspendedSessions).toBe(1);
    expect(status.maxConcurrency).toBe(3);
    expect(status.sessions).toHaveLength(2);
  });
});
