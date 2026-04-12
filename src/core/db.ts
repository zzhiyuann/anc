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

  // Create tables (new schema uses INTEGER unix-ms for all created_at / delay_until)
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
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      status TEXT NOT NULL DEFAULT 'queued',
      delay_until INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS budget_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_role TEXT NOT NULL,
      issue_key TEXT NOT NULL,
      tokens INTEGER NOT NULL DEFAULT 0,
      cost_usd REAL NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
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

    CREATE TABLE IF NOT EXISTS discord_links (
      discord_message_id TEXT PRIMARY KEY,
      discord_channel_id TEXT NOT NULL,
      linear_issue_key TEXT,
      linear_comment_id TEXT,
      link_type TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_queue_dispatch ON queue(status, priority ASC, created_at ASC);
    CREATE INDEX IF NOT EXISTS idx_sessions_role ON sessions(role);
    CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at);
    CREATE INDEX IF NOT EXISTS idx_dl_issue ON discord_links(linear_issue_key);
    CREATE INDEX IF NOT EXISTS idx_budget_date ON budget_log(created_at);
    CREATE INDEX IF NOT EXISTS idx_budget_role ON budget_log(agent_role);
    CREATE INDEX IF NOT EXISTS idx_budget_today ON budget_log(created_at, agent_role);
  `);

  // Migrate existing tables from TEXT → INTEGER timestamps (idempotent)
  migrateTimestamps(db);

  return db;
}

/**
 * Migrate queue.created_at / queue.delay_until / budget_log.created_at
 * from TEXT (ISO 8601 / datetime()) to INTEGER (unix ms).
 *
 * Idempotent: inspects PRAGMA table_info and skips if already INTEGER.
 * Runs inside a transaction per table so a failure leaves the table intact.
 */
function migrateTimestamps(d: Database.Database): void {
  interface ColumnInfo { name: string; type: string }

  const getColumn = (table: string, col: string): ColumnInfo | undefined => {
    const rows = d.prepare(`PRAGMA table_info(${table})`).all() as ColumnInfo[];
    return rows.find(r => r.name === col);
  };

  const needsMigration = (table: string, col: string): boolean => {
    const info = getColumn(table, col);
    if (!info) return false;
    return info.type.toUpperCase() !== 'INTEGER';
  };

  // --- queue table ---
  if (needsMigration('queue', 'created_at') || needsMigration('queue', 'delay_until')) {
    log.info('Migrating queue table timestamps TEXT → INTEGER');
    const tx = d.transaction(() => {
      d.exec(`
        CREATE TABLE queue_new (
          id TEXT PRIMARY KEY,
          issue_key TEXT NOT NULL,
          issue_id TEXT NOT NULL DEFAULT '',
          agent_role TEXT NOT NULL,
          priority INTEGER NOT NULL DEFAULT 3,
          context TEXT,
          created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
          status TEXT NOT NULL DEFAULT 'queued',
          delay_until INTEGER DEFAULT 0
        );

        INSERT INTO queue_new (id, issue_key, issue_id, agent_role, priority, context, created_at, status, delay_until)
        SELECT
          id,
          issue_key,
          issue_id,
          agent_role,
          priority,
          context,
          CAST(strftime('%s', created_at) AS INTEGER) * 1000,
          status,
          CASE
            WHEN delay_until IS NULL THEN 0
            ELSE CAST(strftime('%s', delay_until) AS INTEGER) * 1000
          END
        FROM queue;

        DROP INDEX IF EXISTS idx_queue_dispatch;
        DROP TABLE queue;
        ALTER TABLE queue_new RENAME TO queue;
        CREATE INDEX IF NOT EXISTS idx_queue_dispatch ON queue(status, priority ASC, created_at ASC);
      `);
    });
    tx();
  }

  // --- budget_log table ---
  if (needsMigration('budget_log', 'created_at')) {
    log.info('Migrating budget_log table timestamp TEXT → INTEGER');
    const tx = d.transaction(() => {
      d.exec(`
        CREATE TABLE budget_log_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          agent_role TEXT NOT NULL,
          issue_key TEXT NOT NULL,
          tokens INTEGER NOT NULL DEFAULT 0,
          cost_usd REAL NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
        );

        INSERT INTO budget_log_new (id, agent_role, issue_key, tokens, cost_usd, created_at)
        SELECT
          id,
          agent_role,
          issue_key,
          tokens,
          cost_usd,
          CAST(strftime('%s', created_at) AS INTEGER) * 1000
        FROM budget_log;

        DROP INDEX IF EXISTS idx_budget_date;
        DROP INDEX IF EXISTS idx_budget_role;
        DROP INDEX IF EXISTS idx_budget_today;
        DROP TABLE budget_log;
        ALTER TABLE budget_log_new RENAME TO budget_log;
        CREATE INDEX IF NOT EXISTS idx_budget_date ON budget_log(created_at);
        CREATE INDEX IF NOT EXISTS idx_budget_role ON budget_log(agent_role);
        CREATE INDEX IF NOT EXISTS idx_budget_today ON budget_log(created_at, agent_role);
      `);
    });
    tx();
  }
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
    createdAt: r.created_at as number,
    status: r.status as QueueItem['status'],
  }));
}

export function deleteQueueItem(id: string): void {
  getDb().prepare('DELETE FROM queue WHERE id = ?').run(id);
}

export function clearOldQueueItems(olderThanMs: number): number {
  const cutoff = Date.now() - olderThanMs;
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
