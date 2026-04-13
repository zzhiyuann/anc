// TODO parent: wire into src/api/routes.ts
/**
 * Objectives & Key Results — quarterly OKRs for the one-person company.
 *
 * Schema is additive: CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS so
 * it can be merged independently of any other wave's migrations.
 *
 * Surfaced by the /pulse dashboard (apps/web/src/app/pulse). Not yet routed —
 * the parent agent will wire these helpers into src/api/routes.ts.
 */

import { randomUUID } from 'crypto';
import { getDb } from './db.js';

export interface Objective {
  id: string;
  title: string;
  quarter: string; // e.g. "2026 Q2"
  createdAt: number;
  keyResults: KeyResult[];
}

export interface KeyResult {
  id: string;
  objectiveId: string;
  title: string;
  metric: string;
  target: number;
  current: number;
  createdAt: number;
}

let initialized = false;

function ensureSchema(): void {
  if (initialized) return;
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS objectives (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      quarter TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_objectives_quarter
      ON objectives(quarter);

    CREATE TABLE IF NOT EXISTS key_results (
      id TEXT PRIMARY KEY,
      objective_id TEXT NOT NULL,
      title TEXT NOT NULL,
      metric TEXT NOT NULL,
      target REAL NOT NULL,
      current REAL NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (objective_id) REFERENCES objectives(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_key_results_objective
      ON key_results(objective_id);
  `);
  initialized = true;
}

interface ObjectiveRow {
  id: string;
  title: string;
  quarter: string;
  created_at: number;
}

interface KeyResultRow {
  id: string;
  objective_id: string;
  title: string;
  metric: string;
  target: number;
  current: number;
  created_at: number;
}

function rowToKr(row: KeyResultRow): KeyResult {
  return {
    id: row.id,
    objectiveId: row.objective_id,
    title: row.title,
    metric: row.metric,
    target: row.target,
    current: row.current,
    createdAt: row.created_at,
  };
}

export function listObjectives(quarter?: string): Objective[] {
  ensureSchema();
  const db = getDb();
  const objRows = (
    quarter
      ? db
          .prepare(
            `SELECT * FROM objectives WHERE quarter = ? ORDER BY created_at DESC`,
          )
          .all(quarter)
      : db
          .prepare(`SELECT * FROM objectives ORDER BY created_at DESC`)
          .all()
  ) as ObjectiveRow[];

  if (objRows.length === 0) return [];

  const ids = objRows.map((o) => o.id);
  const placeholders = ids.map(() => '?').join(',');
  const krRows = db
    .prepare(
      `SELECT * FROM key_results WHERE objective_id IN (${placeholders}) ORDER BY created_at ASC`,
    )
    .all(...ids) as KeyResultRow[];

  const byObj = new Map<string, KeyResult[]>();
  for (const k of krRows) {
    const list = byObj.get(k.objective_id) ?? [];
    list.push(rowToKr(k));
    byObj.set(k.objective_id, list);
  }

  return objRows.map((o) => ({
    id: o.id,
    title: o.title,
    quarter: o.quarter,
    createdAt: o.created_at,
    keyResults: byObj.get(o.id) ?? [],
  }));
}

export function createObjective(input: {
  title: string;
  quarter: string;
}): Objective {
  ensureSchema();
  const db = getDb();
  const id = randomUUID();
  const createdAt = Date.now();
  db.prepare(
    `INSERT INTO objectives (id, title, quarter, created_at) VALUES (?, ?, ?, ?)`,
  ).run(id, input.title, input.quarter, createdAt);
  return {
    id,
    title: input.title,
    quarter: input.quarter,
    createdAt,
    keyResults: [],
  };
}

export function addKeyResult(
  objectiveId: string,
  input: { title: string; metric: string; target: number },
): KeyResult {
  ensureSchema();
  const db = getDb();
  const id = randomUUID();
  const createdAt = Date.now();
  db.prepare(
    `INSERT INTO key_results (id, objective_id, title, metric, target, current, created_at)
     VALUES (?, ?, ?, ?, ?, 0, ?)`,
  ).run(id, objectiveId, input.title, input.metric, input.target, createdAt);
  return {
    id,
    objectiveId,
    title: input.title,
    metric: input.metric,
    target: input.target,
    current: 0,
    createdAt,
  };
}

export function updateKeyResult(
  id: string,
  patch: { current: number },
): KeyResult | null {
  ensureSchema();
  const db = getDb();
  db.prepare(`UPDATE key_results SET current = ? WHERE id = ?`).run(
    patch.current,
    id,
  );
  const row = db
    .prepare(`SELECT * FROM key_results WHERE id = ?`)
    .get(id) as KeyResultRow | undefined;
  return row ? rowToKr(row) : null;
}
