/**
 * Label CRUD + many-to-many task ↔ label join.
 *
 * The labels table is seeded with 4 defaults (bug/feature/research/urgent) on
 * DB init. Labels are referenced by name from the dashboard, so setTaskLabels
 * upserts unknown names automatically.
 */

import { getDb } from './db.js';

export interface Label {
  id: number;
  name: string;
  color: string;
  createdAt: number;
}

function rowToLabel(r: Record<string, unknown>): Label {
  return {
    id: r.id as number,
    name: r.name as string,
    color: r.color as string,
    createdAt: r.created_at as number,
  };
}

export function listLabels(): Label[] {
  const rows = getDb()
    .prepare('SELECT * FROM labels ORDER BY name ASC')
    .all() as Array<Record<string, unknown>>;
  return rows.map(rowToLabel);
}

export function getLabel(id: number): Label | null {
  const row = getDb().prepare('SELECT * FROM labels WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? rowToLabel(row) : null;
}

export function getLabelByName(name: string): Label | null {
  const row = getDb().prepare('SELECT * FROM labels WHERE name = ?').get(name) as
    | Record<string, unknown>
    | undefined;
  return row ? rowToLabel(row) : null;
}

export interface CreateLabelInput {
  name: string;
  color?: string;
}

export function createLabel(input: CreateLabelInput): Label {
  const name = input.name.trim();
  if (!name) throw new Error('label name required');
  const color = input.color ?? '#6b7280';
  const db = getDb();
  // Upsert: if name already exists, return existing row (label names are unique).
  const existing = getLabelByName(name);
  if (existing) return existing;
  const result = db
    .prepare('INSERT INTO labels (name, color) VALUES (?, ?)')
    .run(name, color);
  return getLabel(Number(result.lastInsertRowid))!;
}

export function deleteLabel(id: number): boolean {
  const db = getDb();
  const tx = db.transaction((labelId: number): boolean => {
    db.prepare('DELETE FROM task_labels WHERE label_id = ?').run(labelId);
    const r = db.prepare('DELETE FROM labels WHERE id = ?').run(labelId);
    return r.changes > 0;
  });
  return tx(id);
}

/**
 * Replace the set of labels attached to a task. Unknown label names are
 * upserted (created with the default color). Returns the canonical name list
 * after the operation.
 */
export function setTaskLabels(taskId: string, labelNames: string[]): string[] {
  const db = getDb();
  const cleaned = Array.from(
    new Set(labelNames.map(n => (typeof n === 'string' ? n.trim() : '')).filter(Boolean)),
  );
  const tx = db.transaction((tid: string, names: string[]) => {
    db.prepare('DELETE FROM task_labels WHERE task_id = ?').run(tid);
    const insertLabel = db.prepare('INSERT OR IGNORE INTO labels (name, color) VALUES (?, ?)');
    const selectId = db.prepare('SELECT id FROM labels WHERE name = ?');
    const insertJoin = db.prepare(
      'INSERT OR IGNORE INTO task_labels (task_id, label_id) VALUES (?, ?)',
    );
    for (const name of names) {
      insertLabel.run(name, '#6b7280');
      const row = selectId.get(name) as { id: number } | undefined;
      if (row) insertJoin.run(tid, row.id);
    }
  });
  tx(taskId, cleaned);
  return getTaskLabels(taskId);
}

export function getTaskLabels(taskId: string): string[] {
  const rows = getDb()
    .prepare(
      `SELECT l.name AS name FROM task_labels tl
       JOIN labels l ON l.id = tl.label_id
       WHERE tl.task_id = ?
       ORDER BY l.name ASC`,
    )
    .all(taskId) as Array<{ name: string }>;
  return rows.map(r => r.name);
}

/**
 * Return a map { taskId -> string[] } for many tasks at once. Used by the
 * task-list endpoint so the dashboard avoids N additional fetches.
 */
export function getLabelsForTasks(taskIds: string[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (taskIds.length === 0) return out;
  const placeholders = taskIds.map(() => '?').join(',');
  const rows = getDb()
    .prepare(
      `SELECT tl.task_id AS task_id, l.name AS name FROM task_labels tl
       JOIN labels l ON l.id = tl.label_id
       WHERE tl.task_id IN (${placeholders})
       ORDER BY l.name ASC`,
    )
    .all(...taskIds) as Array<{ task_id: string; name: string }>;
  for (const r of rows) {
    if (!out[r.task_id]) out[r.task_id] = [];
    out[r.task_id].push(r.name);
  }
  return out;
}
