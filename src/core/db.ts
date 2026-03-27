/**
 * SQLite persistence layer — disposable cache backed by Linear as truth.
 * Survives server restarts. Can be deleted and rebuilt from Linear at any time.
 *
 * Tables:
 *   sessions — tracked agent sessions (health.ts state)
 *   queue    — priority dispatch queue
 *   breakers — circuit breaker failure counts
 *   events   — audit log of lifecycle events
 */

import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { createLogger } from './logger.js';

const log = createLogger('db');
import type { QueueItem } from '../linear/types.js';
import type { TrackedSession, SessionState } from '../runtime/health.js';

const DB_PATH = join(homedir(), '.anc', 'state.db');

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;

  const dir = dirname(DB_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');

  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      issue_key TEXT PRIMARY KEY,
      role TEXT NOT NULL,
      tmux_session TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'active',
      spawned_at INTEGER NOT NULL,
      suspended_at INTEGER,
      idle_since INTEGER,
      priority INTEGER NOT NULL DEFAULT 3,
      ceo_assigned INTEGER NOT NULL DEFAULT 0,
      handoff_processed INTEGER NOT NULL DEFAULT 0,
      use_continue INTEGER NOT NULL DEFAULT 0,
      is_duty INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS queue (
      id TEXT PRIMARY KEY,
      issue_key TEXT NOT NULL,
      issue_id TEXT NOT NULL DEFAULT '',
      agent_role TEXT NOT NULL,
      priority INTEGER NOT NULL DEFAULT 3,
      context TEXT,
      created_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued'
    );

    CREATE TABLE IF NOT EXISTS breakers (
      issue_key TEXT PRIMARY KEY,
      fail_count INTEGER NOT NULL DEFAULT 0,
      last_fail_at INTEGER NOT NULL DEFAULT 0,
      backoff_until INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      role TEXT,
      issue_key TEXT,
      detail TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_queue_status ON queue(status);
    CREATE INDEX IF NOT EXISTS idx_sessions_role ON sessions(role);
    CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at);
  `);

  return db;
}

// --- Session persistence ---

export function saveSessions(sessions: TrackedSession[]): void {
  const d = getDb();
  const upsert = d.prepare(`
    INSERT OR REPLACE INTO sessions
    (issue_key, role, tmux_session, state, spawned_at, suspended_at, idle_since,
     priority, ceo_assigned, handoff_processed, use_continue, is_duty)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const tx = d.transaction(() => {
    for (const s of sessions) {
      upsert.run(
        s.issueKey, s.role, s.tmuxSession, s.state, s.spawnedAt,
        s.suspendedAt ?? null, s.idleSince ?? null, s.priority,
        s.ceoAssigned ? 1 : 0, s.handoffProcessed ? 1 : 0,
        s.useContinue ? 1 : 0, s.isDuty ? 1 : 0,
      );
    }
  });
  tx();
}

export function loadSessions(): TrackedSession[] {
  const d = getDb();
  const rows = d.prepare('SELECT * FROM sessions').all() as Array<Record<string, unknown>>;
  return rows.map(r => ({
    role: r.role as string,
    issueKey: r.issue_key as string,
    tmuxSession: r.tmux_session as string,
    state: r.state as SessionState,
    spawnedAt: r.spawned_at as number,
    suspendedAt: r.suspended_at as number | undefined,
    idleSince: r.idle_since as number | undefined,
    priority: r.priority as number,
    ceoAssigned: r.ceo_assigned === 1,
    handoffProcessed: r.handoff_processed === 1,
    useContinue: r.use_continue === 1,
    isDuty: r.is_duty === 1,
  }));
}

export function deleteSession(issueKey: string): void {
  getDb().prepare('DELETE FROM sessions WHERE issue_key = ?').run(issueKey);
}

// --- Queue persistence ---

export function saveQueueItem(item: QueueItem): void {
  getDb().prepare(`
    INSERT OR REPLACE INTO queue (id, issue_key, issue_id, agent_role, priority, context, created_at, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(item.id, item.issueKey, item.issueId, item.agentRole, item.priority, item.context ?? null, item.createdAt, item.status);
}

export function loadQueueItems(): QueueItem[] {
  const rows = getDb().prepare('SELECT * FROM queue ORDER BY priority ASC, created_at ASC').all() as Array<Record<string, unknown>>;
  return rows.map(r => ({
    id: r.id as string,
    issueKey: r.issue_key as string,
    issueId: r.issue_id as string,
    agentRole: r.agent_role as string,
    priority: r.priority as number,
    context: r.context as string | undefined,
    createdAt: r.created_at as string,
    status: r.status as QueueItem['status'],
  }));
}

export function deleteQueueItem(id: string): void {
  getDb().prepare('DELETE FROM queue WHERE id = ?').run(id);
}

export function clearOldQueueItems(olderThanMs: number): number {
  const cutoff = new Date(Date.now() - olderThanMs).toISOString();
  const result = getDb().prepare("DELETE FROM queue WHERE status IN ('completed', 'canceled') AND created_at < ?").run(cutoff);
  return result.changes;
}

// --- Breaker persistence ---

export function saveBreaker(issueKey: string, failCount: number, lastFailAt: number, backoffUntil: number): void {
  getDb().prepare(`
    INSERT OR REPLACE INTO breakers (issue_key, fail_count, last_fail_at, backoff_until)
    VALUES (?, ?, ?, ?)
  `).run(issueKey, failCount, lastFailAt, backoffUntil);
}

export function loadBreakers(): Array<{ issueKey: string; failCount: number; lastFailAt: number; backoffUntil: number }> {
  const rows = getDb().prepare('SELECT * FROM breakers').all() as Array<Record<string, unknown>>;
  return rows.map(r => ({
    issueKey: r.issue_key as string,
    failCount: r.fail_count as number,
    lastFailAt: r.last_fail_at as number,
    backoffUntil: r.backoff_until as number,
  }));
}

export function deleteBreaker(issueKey: string): void {
  getDb().prepare('DELETE FROM breakers WHERE issue_key = ?').run(issueKey);
}

// --- Event log ---

export function logEvent(type: string, role?: string, issueKey?: string, detail?: string): void {
  getDb().prepare(`
    INSERT INTO events (event_type, role, issue_key, detail) VALUES (?, ?, ?, ?)
  `).run(type, role ?? null, issueKey ?? null, detail ?? null);
}

export function getRecentEvents(limit: number = 50): Array<{ id: number; eventType: string; role?: string; issueKey?: string; detail?: string; createdAt: string }> {
  const rows = getDb().prepare('SELECT * FROM events ORDER BY id DESC LIMIT ?').all(limit) as Array<Record<string, unknown>>;
  return rows.map(r => ({
    id: r.id as number,
    eventType: r.event_type as string,
    role: r.role as string | undefined,
    issueKey: r.issue_key as string | undefined,
    detail: r.detail as string | undefined,
    createdAt: r.created_at as string,
  }));
}

// --- Lifecycle ---

export function closeDb(): void {
  if (db) {
    try {
      db.pragma('wal_checkpoint(TRUNCATE)');
      db.close();
    } catch (err) {
      log.warn(`DB close error: ${(err as Error).message}`);
    }
    db = null;
  }
}

export function backupDb(): void {
  if (!db) return;
  try {
    const backupPath = DB_PATH + '.bak';
    db.backup(backupPath);
  } catch (err) {
    log.warn(`DB backup error: ${(err as Error).message}`);
  }
}
