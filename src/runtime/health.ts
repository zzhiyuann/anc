/**
 * Session lifecycle manager — the OS scheduler of ANC.
 *
 * Three states:
 *   ACTIVE    — tmux alive, claude running, consuming resources
 *   SUSPENDED — tmux killed, workspace + SUSPEND.md preserved, zero resources
 *   (completed/failed are terminal — session removed from tracking)
 *
 * Like virtual memory: swap sessions in/out based on concurrency limits and priority.
 */

import { sessionExists } from './runner.js';
import { bus } from '../bus.js';
import { getAgent } from '../agents/registry.js';
import type { AgentRole } from '../linear/types.js';

// --- Session states ---

export type SessionState = 'active' | 'suspended';

export interface TrackedSession {
  role: AgentRole;
  issueKey: string;
  tmuxSession: string;
  state: SessionState;
  spawnedAt: number;
  suspendedAt?: number;
  priority: number;         // issue priority (lower = more important)
  ceoAssigned: boolean;     // CEO manually assigned → never auto-suspend
}

// All tracked sessions (active + suspended)
const sessions = new Map<string, TrackedSession>();  // key = issueKey

// --- Track / Untrack ---

export function trackSession(session: Omit<TrackedSession, 'state'>): void {
  sessions.set(session.issueKey, { ...session, state: 'active' });
}

export function untrackSession(issueKey: string): void {
  sessions.delete(issueKey);
}

// --- Query ---

export function getTrackedSessions(): TrackedSession[] {
  return [...sessions.values()];
}

export function getSessionForIssue(issueKey: string): TrackedSession | undefined {
  return sessions.get(issueKey);
}

/** Get all ACTIVE sessions for a role */
export function getActiveSessions(role: AgentRole): TrackedSession[] {
  return [...sessions.values()].filter(s => s.role === role && s.state === 'active');
}

/** Get all SUSPENDED sessions for a role */
export function getSuspendedSessions(role: AgentRole): TrackedSession[] {
  return [...sessions.values()].filter(s => s.role === role && s.state === 'suspended');
}

/** Get all sessions (any state) for a role */
export function getAllSessionsForRole(role: AgentRole): TrackedSession[] {
  return [...sessions.values()].filter(s => s.role === role);
}

/** How many active sessions does this role have? */
export function activeCount(role: AgentRole): number {
  return getActiveSessions(role).length;
}

/** Can this role accept another active session? */
export function hasCapacity(role: AgentRole): boolean {
  const agent = getAgent(role);
  if (!agent) return false;
  return activeCount(role) < agent.maxConcurrency;
}

/** Is a specific issue currently being actively worked on? */
export function isIssueActive(issueKey: string): boolean {
  const s = sessions.get(issueKey);
  return s?.state === 'active' && sessionExists(s.tmuxSession);
}

/** Is a specific issue suspended (not dead, just paused)? */
export function isIssueSuspended(issueKey: string): boolean {
  return sessions.get(issueKey)?.state === 'suspended';
}

// --- Suspend ---

/** Mark a session as suspended (caller handles the actual tmux kill) */
export function markSuspended(issueKey: string): boolean {
  const s = sessions.get(issueKey);
  if (!s || s.state !== 'active') return false;
  s.state = 'suspended';
  s.suspendedAt = Date.now();
  return true;
}

/** Pick the best session to suspend for a given role (when at capacity).
 *  Priority: idle > low priority > oldest active
 *  NEVER suspends CEO-assigned sessions. */
export function pickSessionToSuspend(role: AgentRole): TrackedSession | null {
  const active = getActiveSessions(role)
    .filter(s => !s.ceoAssigned)  // never auto-suspend CEO-assigned
    .filter(s => sessionExists(s.tmuxSession));  // only living sessions

  if (active.length === 0) return null;

  // Sort: higher priority number (= lower priority) first, then oldest
  active.sort((a, b) => {
    if (a.priority !== b.priority) return b.priority - a.priority;  // 4 > 3 > 2 > 1
    return a.spawnedAt - b.spawnedAt;  // oldest first
  });

  return active[0];
}

// --- Resume ---

/** Mark a session as active again (caller handles the actual tmux respawn) */
export function markResumed(issueKey: string, tmuxSession: string): boolean {
  const s = sessions.get(issueKey);
  if (!s || s.state !== 'suspended') return false;
  s.state = 'active';
  s.tmuxSession = tmuxSession;
  s.suspendedAt = undefined;
  s.spawnedAt = Date.now();
  return true;
}

// --- Health check ---

export function getHealthStatus(role: AgentRole): { activeSessions: number; suspendedSessions: number; maxConcurrency: number; sessions: Array<{ issueKey: string; state: SessionState; uptime?: number }> } {
  const agent = getAgent(role);
  const allRole = getAllSessionsForRole(role);
  const now = Date.now();

  return {
    activeSessions: allRole.filter(s => s.state === 'active').length,
    suspendedSessions: allRole.filter(s => s.state === 'suspended').length,
    maxConcurrency: agent?.maxConcurrency ?? 1,
    sessions: allRole.map(s => ({
      issueKey: s.issueKey,
      state: s.state,
      uptime: s.state === 'active' ? Math.round((now - s.spawnedAt) / 1000) : undefined,
    })),
  };
}

/** Run health checks on all active sessions — detect dead processes */
export function checkAllHealth(): void {
  for (const [issueKey, session] of sessions.entries()) {
    if (session.state !== 'active') continue;

    const alive = sessionExists(session.tmuxSession);
    bus.emit('agent:health', { role: session.role, alive, tmuxSession: session.tmuxSession });

    if (!alive) {
      // Process died — this is NOT a suspension (no SUSPEND.md written)
      // Let the completion handler decide if it was intentional (HANDOFF.md exists)
      // or a failure (nothing written)
      // We just update our tracking — the tick handler will detect HANDOFF/failure
    }
  }
}

export function _resetHealth(): void {
  sessions.clear();
}
