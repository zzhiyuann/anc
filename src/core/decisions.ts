// TODO parent: wire into src/api/routes.ts
/**
 * Decision Log — append-only record of architecture / product / strategy calls
 * the CEO (or an agent) made, surfaced on the /pulse dashboard so nothing is
 * silently forgotten or revisited without context.
 */

import { randomUUID } from 'crypto';
import { getDb } from './db.js';

export interface Decision {
  id: string;
  title: string;
  rationale: string;
  decidedBy: string;
  tags: string[];
  createdAt: number;
}

let initialized = false;

function ensureSchema(): void {
  if (initialized) return;
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS decisions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      rationale TEXT NOT NULL,
      decided_by TEXT NOT NULL,
      tags TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_decisions_created_at
      ON decisions(created_at);
  `);
  initialized = true;
}

interface DecisionRow {
  id: string;
  title: string;
  rationale: string;
  decided_by: string;
  tags: string;
  created_at: number;
}

function rowToDecision(row: DecisionRow): Decision {
  let tags: string[] = [];
  try {
    const parsed = JSON.parse(row.tags);
    if (Array.isArray(parsed)) tags = parsed.filter((t) => typeof t === 'string');
  } catch {
    tags = [];
  }
  return {
    id: row.id,
    title: row.title,
    rationale: row.rationale,
    decidedBy: row.decided_by,
    tags,
    createdAt: row.created_at,
  };
}

export function listDecisions(opts: { limit?: number } = {}): Decision[] {
  ensureSchema();
  const limit = Math.max(1, Math.min(opts.limit ?? 20, 200));
  const db = getDb();
  const rows = db
    .prepare(`SELECT * FROM decisions ORDER BY created_at DESC LIMIT ?`)
    .all(limit) as DecisionRow[];
  return rows.map(rowToDecision);
}

export function createDecision(input: {
  title: string;
  rationale: string;
  decidedBy: string;
  tags?: string[];
}): Decision {
  ensureSchema();
  const db = getDb();
  const id = randomUUID();
  const createdAt = Date.now();
  const tags = input.tags ?? [];
  db.prepare(
    `INSERT INTO decisions (id, title, rationale, decided_by, tags, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.title,
    input.rationale,
    input.decidedBy,
    JSON.stringify(tags),
    createdAt,
  );
  return {
    id,
    title: input.title,
    rationale: input.rationale,
    decidedBy: input.decidedBy,
    tags,
    createdAt,
  };
}
