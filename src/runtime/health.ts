/**
 * Session lifecycle manager — the OS scheduler of ANC.
 *
 * Three states:
 *   ACTIVE    — tmux alive, claude running (-p mode, will exit when done)
 *   IDLE      — tmux dead, workspace preserved, resumable via --continue
 *   SUSPENDED — workspace + SUSPEND.md preserved, resumable via --continue
 *
 * Key insight: idle = tmux dead but conversation context preserved in workspace.
 * --continue flag resumes without reloading persona/memory.
 *
 * Capacity: only ACTIVE sessions count against maxConcurrency.
 * Idle sessions are free (zero resources) and can be evicted silently.
 */

import { bus } from '../bus.js';
import { getAgent } from '../agents/registry.js';
import type { AgentRole } from '../linear/types.js';

export type SessionState = 'active' | 'idle' | 'suspended';

export interface TrackedSession {
  role: AgentRole;
  issueKey: string;
  tmuxSession: string;        // last known tmux name (dead when idle)
  state: SessionState;
  spawnedAt: number;
  suspendedAt?: number;
  idleSince?: number;
  priority: number;           // issue priority (lower = more important)
  ceoAssigned: boolean;       // CEO manually assigned → never auto-suspend
  handoffProcessed: boolean;  // HANDOFF.md already handled for this session cycle
  useContinue: boolean;       // has prior context → use --continue on next spawn
  isDuty: boolean;            // proactive duty session (uses separate capacity pool)
}

// All tracked sessions (active + idle + suspended)
const sessions = new Map<string, TrackedSession>();  // key = issueKey

// --- Track / Untrack ---

export function trackSession(params: {
  role: AgentRole; issueKey: string; tmuxSession: string; spawnedAt: number;
  priority: number; ceoAssigned: boolean; useContinue?: boolean; isDuty?: boolean;
}): void {
  sessions.set(params.issueKey, {
    ...params,
    state: 'active',
    handoffProcessed: false,
    useContinue: params.useContinue ?? false,
    isDuty: params.isDuty ?? false,
  });
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

export function getActiveSessions(role: AgentRole): TrackedSession[] {
  return [...sessions.values()].filter(s => s.role === role && s.state === 'active');
}

export function getIdleSessions(role: AgentRole): TrackedSession[] {
  return [...sessions.values()].filter(s => s.role === role && s.state === 'idle');
}

export function getSuspendedSessions(role: AgentRole): TrackedSession[] {
  return [...sessions.values()].filter(s => s.role === role && s.state === 'suspended');
}

export function getAllSessionsForRole(role: AgentRole): TrackedSession[] {
  return [...sessions.values()].filter(s => s.role === role);
}

/** Count active TASK sessions (excludes duties) */
export function activeTaskCount(role: AgentRole): number {
  return getActiveSessions(role).filter(s => !s.isDuty).length;
}

/** Count active DUTY sessions */
export function activeDutyCount(role: AgentRole): number {
  return getActiveSessions(role).filter(s => s.isDuty).length;
}

/** Legacy: total active count */
export function activeCount(role: AgentRole): number {
  return getActiveSessions(role).length;
}

/** Can this role accept another TASK session? */
export function hasCapacity(role: AgentRole): boolean {
  const agent = getAgent(role);
  if (!agent) return false;
  return activeTaskCount(role) < agent.maxConcurrency;
}

/** Can this role accept another DUTY session? (separate pool) */
export function hasDutyCapacity(role: AgentRole): boolean {
  const agent = getAgent(role);
  if (!agent) return false;
  return activeDutyCount(role) < agent.dutySlots;
}

export function isIssueActive(issueKey: string): boolean {
  return sessions.get(issueKey)?.state === 'active';
}

export function isIssueIdle(issueKey: string): boolean {
  return sessions.get(issueKey)?.state === 'idle';
}

export function isIssueSuspended(issueKey: string): boolean {
  return sessions.get(issueKey)?.state === 'suspended';
}

// --- State transitions ---

/** Active → Idle (claude exited, workspace preserved) */
export function markIdle(issueKey: string): boolean {
  const s = sessions.get(issueKey);
  if (!s || s.state !== 'active') return false;
  s.state = 'idle';
  s.idleSince = Date.now();
  s.useContinue = true;  // can now --continue
  return true;
}

/** Idle → Active (follow-up arrived, new tmux spawned with --continue) */
export function markActiveFromIdle(issueKey: string, tmuxSession: string): boolean {
  const s = sessions.get(issueKey);
  if (!s || s.state !== 'idle') return false;
  s.state = 'active';
  s.tmuxSession = tmuxSession;
  s.idleSince = undefined;
  s.spawnedAt = Date.now();
  s.handoffProcessed = false;  // reset for new work cycle
  return true;
}

/** Active → Suspended (capacity pressure, checkpoint written) */
export function markSuspended(issueKey: string): boolean {
  const s = sessions.get(issueKey);
  if (!s || s.state !== 'active') return false;
  s.state = 'suspended';
  s.suspendedAt = Date.now();
  s.useContinue = true;
  return true;
}

/** Suspended → Active (resumed with --continue) */
export function markResumed(issueKey: string, tmuxSession: string): boolean {
  const s = sessions.get(issueKey);
  if (!s || s.state !== 'suspended') return false;
  s.state = 'active';
  s.tmuxSession = tmuxSession;
  s.suspendedAt = undefined;
  s.spawnedAt = Date.now();
  s.handoffProcessed = false;
  return true;
}

// --- Eviction priority ---

/** Pick the best session to evict for a given role.
 *  Priority: idle with HANDOFF processed → idle without → active low-priority → null
 *  NEVER evicts CEO-assigned active sessions. */
export function pickToEvict(role: AgentRole): TrackedSession | null {
  // Tier 1: idle sessions (zero cost to evict)
  const idle = getIdleSessions(role);
  if (idle.length > 0) {
    // Prefer ones with handoff already processed (fully done)
    const processed = idle.filter(s => s.handoffProcessed);
    if (processed.length > 0) return processed[0];
    // Otherwise, oldest idle
    idle.sort((a, b) => (a.idleSince ?? 0) - (b.idleSince ?? 0));
    return idle[0];
  }

  // Tier 2: active sessions (expensive — needs suspend protocol)
  const active = getActiveSessions(role).filter(s => !s.ceoAssigned);
  if (active.length === 0) return null;

  // Sort: highest priority number (= lowest importance) first, then oldest
  active.sort((a, b) => {
    if (a.priority !== b.priority) return b.priority - a.priority;
    return a.spawnedAt - b.spawnedAt;
  });

  return active[0];
}

// --- Health status ---

export function getHealthStatus(role: AgentRole): {
  activeSessions: number; idleSessions: number; suspendedSessions: number;
  maxConcurrency: number;
  sessions: Array<{ issueKey: string; state: SessionState; uptime?: number }>;
} {
  const agent = getAgent(role);
  const all = getAllSessionsForRole(role);
  const now = Date.now();

  return {
    activeSessions: all.filter(s => s.state === 'active').length,
    idleSessions: all.filter(s => s.state === 'idle').length,
    suspendedSessions: all.filter(s => s.state === 'suspended').length,
    maxConcurrency: agent?.maxConcurrency ?? 1,
    sessions: all.map(s => ({
      issueKey: s.issueKey,
      state: s.state,
      uptime: s.state === 'active' ? Math.round((now - s.spawnedAt) / 1000) : undefined,
    })),
  };
}

/** No-op health check — in hybrid model, active sessions have live tmux.
 *  Dead tmux = session completed or failed. Detected by on-complete.ts. */
export function checkAllHealth(): void {
  // In the hybrid model, this is handled by on-complete.ts tick
  // which checks each active session for tmux liveness.
}

export function _resetHealth(): void {
  sessions.clear();
}
