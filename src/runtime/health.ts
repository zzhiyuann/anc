/**
 * Health monitor — tracks agent process liveness.
 * tmux is a runtime detail, checked ONLY for "is the process alive?"
 * Never used as source of truth for what an agent is working on.
 */

import { sessionExists } from './runner.js';
import { bus } from '../bus.js';
import type { AgentRole } from '../linear/types.js';

export interface TrackedSession {
  role: AgentRole;
  issueKey: string;
  tmuxSession: string;
  spawnedAt: number;
}

const activeSessions = new Map<string, TrackedSession>();

export function trackSession(session: TrackedSession): void {
  activeSessions.set(session.tmuxSession, session);
}

export function untrackSession(tmuxSession: string): void {
  activeSessions.delete(tmuxSession);
}

export function getTrackedSessions(): TrackedSession[] {
  return [...activeSessions.values()];
}

export function getActiveSession(role: AgentRole): TrackedSession | undefined {
  return [...activeSessions.values()].find(s => s.role === role);
}

export function getSessionForIssue(issueKey: string): TrackedSession | undefined {
  return [...activeSessions.values()].find(s => s.issueKey === issueKey);
}

export function getHealthStatus(role: AgentRole): { active: boolean; issueKey?: string; tmuxSession?: string; uptime?: number } {
  const session = getActiveSession(role);
  if (!session) return { active: false };

  const alive = sessionExists(session.tmuxSession);
  if (!alive) {
    // Process died — clean up tracking
    untrackSession(session.tmuxSession);
    bus.emit('agent:failed', { role, issueKey: session.issueKey, error: 'tmux session died' });
    return { active: false };
  }

  return {
    active: true,
    issueKey: session.issueKey,
    tmuxSession: session.tmuxSession,
    uptime: Math.round((Date.now() - session.spawnedAt) / 1000),
  };
}

/** Run health checks on all tracked sessions */
export function checkAllHealth(): void {
  for (const [tmux, session] of activeSessions.entries()) {
    const alive = sessionExists(tmux);
    bus.emit('agent:health', { role: session.role, alive, tmuxSession: tmux });
    if (!alive) {
      untrackSession(tmux);
    }
  }
}

/** Is a given role currently busy? */
export function isRoleBusy(role: AgentRole): boolean {
  const session = getActiveSession(role);
  if (!session) return false;
  return sessionExists(session.tmuxSession);
}

export function _resetHealth(): void {
  activeSessions.clear();
}
