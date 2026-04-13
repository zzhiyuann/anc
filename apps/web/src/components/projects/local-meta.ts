/**
 * Client-side persistence for Linear-style project metadata that the backend
 * does not yet support. Wave B backend gap:
 *   - `health` (on-track / at-risk / off-track / no-update)
 *   - `priority` (1..5, matches task priority scale)
 *   - `lead` (agent role string)
 *   - `targetDate` (ISO yyyy-mm-dd string)
 *
 * Once the backend adds these columns, replace this module with API calls
 * via `api.projects.update(...)`.
 */

import type { ProjectHealth } from "@/lib/types";

export interface ProjectLocalMeta {
  health: ProjectHealth;
  priority: number;
  lead: string | null;
  targetDate: string | null;
}

const STORAGE_KEY = "anc:project-meta:v1";

function readAll(): Record<string, ProjectLocalMeta> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, ProjectLocalMeta>;
  } catch {
    return {};
  }
}

function writeAll(map: Record<string, ProjectLocalMeta>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // ignore quota errors
  }
}

/**
 * Deterministic default seeded from the project id, so refreshes don't shuffle
 * the table while the backend is still missing these fields.
 */
function defaultFor(projectId: string): ProjectLocalMeta {
  let h = 0;
  for (let i = 0; i < projectId.length; i++) {
    h = (Math.imul(h, 31) + projectId.charCodeAt(i)) >>> 0;
  }
  const healths: ProjectHealth[] = ["on-track", "on-track", "at-risk", "off-track", "no-update"];
  const priorities = [1, 2, 3, 3, 4];
  return {
    health: healths[h % healths.length],
    priority: priorities[((h >>> 3) >>> 0) % priorities.length],
    lead: null,
    targetDate: null,
  };
}

export function getProjectMeta(projectId: string): ProjectLocalMeta {
  const all = readAll();
  const def = defaultFor(projectId);
  const stored = all[projectId];
  if (!stored) return def;
  return {
    health: stored.health ?? def.health,
    priority: stored.priority ?? def.priority,
    lead: stored.lead ?? null,
    targetDate: stored.targetDate ?? null,
  };
}

export function setProjectMeta(
  projectId: string,
  patch: Partial<ProjectLocalMeta>,
): ProjectLocalMeta {
  const all = readAll();
  const next: ProjectLocalMeta = { ...(all[projectId] ?? defaultFor(projectId)), ...patch };
  all[projectId] = next;
  writeAll(all);
  return next;
}

export const HEALTH_LABEL: Record<ProjectHealth, string> = {
  "on-track": "On track",
  "at-risk": "At risk",
  "off-track": "Off track",
  "no-update": "No update",
};

export const HEALTH_DOT_CLASS: Record<ProjectHealth, string> = {
  "on-track": "bg-status-active",
  "at-risk": "bg-status-queued",
  "off-track": "bg-status-failed",
  "no-update": "bg-muted-foreground",
};

export const HEALTH_TEXT_CLASS: Record<ProjectHealth, string> = {
  "on-track": "text-status-active",
  "at-risk": "text-status-queued",
  "off-track": "text-status-failed",
  "no-update": "text-muted-foreground",
};

export const ALL_HEALTHS: ProjectHealth[] = [
  "on-track",
  "at-risk",
  "off-track",
  "no-update",
];
