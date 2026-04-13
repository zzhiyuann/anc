/**
 * Project entity CRUD.
 * Projects are top-level organization units containing tasks.
 */

import { createHash } from 'node:crypto';
import { getDb } from './db.js';

export type ProjectState = 'active' | 'paused' | 'archived';
export type ProjectHealth = 'on-track' | 'at-risk' | 'off-track' | 'no-update';

export interface Project {
  id: string;
  name: string;
  description: string | null;
  color: string;
  icon: string | null;
  state: ProjectState;
  createdBy: string;
  createdAt: number;
  archivedAt: number | null;
  // Wave B: Linear-style metadata. All optional so old rows still validate.
  health?: ProjectHealth;
  priority?: number;
  lead?: string | null;
  targetDate?: string | null;
}

function rowToProject(r: Record<string, unknown>): Project {
  return {
    id: r.id as string,
    name: r.name as string,
    description: (r.description as string | null) ?? null,
    color: r.color as string,
    icon: (r.icon as string | null) ?? null,
    state: r.state as ProjectState,
    createdBy: r.created_by as string,
    createdAt: r.created_at as number,
    archivedAt: (r.archived_at as number | null) ?? null,
    health: (r.health as ProjectHealth | null) ?? 'no-update',
    priority: (r.priority as number | null) ?? 3,
    lead: (r.lead as string | null) ?? null,
    targetDate: (r.target_date as string | null) ?? null,
  };
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'proj';
}

function shortHash(s: string): string {
  return createHash('sha1').update(`${s}:${Date.now()}:${Math.random()}`).digest('hex').slice(0, 6);
}

export function createProject(input: Partial<Project> & { name: string }): Project {
  const baseSlug = slugify(input.name);
  let id = input.id ?? `proj-${baseSlug}`;
  // Collision check
  if (!input.id && getDb().prepare('SELECT 1 FROM projects WHERE id = ?').get(id)) {
    id = `proj-${baseSlug}-${shortHash(baseSlug)}`;
  }

  getDb().prepare(`
    INSERT INTO projects (id, name, description, color, icon, state, created_by, created_at, archived_at, health, priority, lead, target_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.name,
    input.description ?? null,
    input.color ?? '#3b82f6',
    input.icon ?? null,
    input.state ?? 'active',
    input.createdBy ?? 'ceo',
    input.createdAt ?? Date.now(),
    input.archivedAt ?? null,
    input.health ?? 'no-update',
    input.priority ?? 3,
    input.lead ?? null,
    input.targetDate ?? null,
  );
  return getProject(id)!;
}

export function getProject(id: string): Project | null {
  const row = getDb().prepare('SELECT * FROM projects WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? rowToProject(row) : null;
}

export function listProjects(filter: { state?: ProjectState; includeArchived?: boolean } = {}): Project[] {
  if (filter.state) {
    const rows = getDb().prepare(
      'SELECT * FROM projects WHERE state = ? ORDER BY created_at DESC'
    ).all(filter.state) as Array<Record<string, unknown>>;
    return rows.map(rowToProject);
  }
  const sql = filter.includeArchived
    ? 'SELECT * FROM projects ORDER BY created_at DESC'
    : "SELECT * FROM projects WHERE state != 'archived' ORDER BY created_at DESC";
  const rows = getDb().prepare(sql).all() as Array<Record<string, unknown>>;
  return rows.map(rowToProject);
}

export function updateProject(id: string, patch: Partial<Project>): Project | null {
  const current = getProject(id);
  if (!current) return null;

  const fieldMap: Record<string, string> = {
    name: 'name',
    description: 'description',
    color: 'color',
    icon: 'icon',
    state: 'state',
    archivedAt: 'archived_at',
    health: 'health',
    priority: 'priority',
    lead: 'lead',
    targetDate: 'target_date',
  };
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [key, col] of Object.entries(fieldMap)) {
    if (key in patch) {
      sets.push(`${col} = ?`);
      params.push((patch as Record<string, unknown>)[key] ?? null);
    }
  }
  if (sets.length === 0) return current;
  params.push(id);
  getDb().prepare(`UPDATE projects SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  return getProject(id);
}

export function archiveProject(id: string): void {
  getDb().prepare(
    "UPDATE projects SET state = 'archived', archived_at = ? WHERE id = ?"
  ).run(Date.now(), id);
}

export interface ProjectStats {
  total: number;
  running: number;
  queued: number;
  done: number;
  totalCostUsd: number;
}

export function getProjectStats(id: string): ProjectStats {
  const rows = getDb().prepare(
    'SELECT state, COUNT(*) as n FROM tasks WHERE project_id = ? GROUP BY state'
  ).all(id) as Array<{ state: string; n: number }>;
  let total = 0, running = 0, queued = 0, done = 0;
  for (const r of rows) {
    total += r.n;
    if (r.state === 'running' || r.state === 'review') running += r.n;
    else if (r.state === 'todo') queued += r.n;
    else if (r.state === 'done') done += r.n;
  }
  // Cost aggregation is not tracked yet at task level — placeholder zero.
  return { total, running, queued, done, totalCostUsd: 0 };
}
