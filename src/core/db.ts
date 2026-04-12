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

function resolveDbPath(): string {
  return process.env.ANC_DB_PATH || join(homedir(), '.anc', 'state.db');
}

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;

  const DB_PATH = resolveDbPath();
  const dir = dirname(DB_PATH);
  if (dir && dir !== ':memory:' && !existsSync(dir)) mkdirSync(dir, { recursive: true });

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

    CREATE TABLE IF NOT EXISTS discord_links (
      discord_message_id TEXT PRIMARY KEY,
      discord_channel_id TEXT NOT NULL,
      linear_issue_key TEXT,
      linear_comment_id TEXT,
      link_type TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_queue_status ON queue(status);
    CREATE INDEX IF NOT EXISTS idx_sessions_role ON sessions(role);
    CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at);
    CREATE INDEX IF NOT EXISTS idx_dl_issue ON discord_links(linear_issue_key);

    CREATE TABLE IF NOT EXISTS projects (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      description   TEXT,
      color         TEXT NOT NULL DEFAULT '#3b82f6',
      icon          TEXT,
      state         TEXT NOT NULL DEFAULT 'active',
      created_by    TEXT NOT NULL DEFAULT 'ceo',
      created_at    INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      archived_at   INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_projects_state ON projects(state, created_at DESC);

    CREATE TABLE IF NOT EXISTS tasks (
      id                TEXT PRIMARY KEY,
      project_id        TEXT REFERENCES projects(id),
      title             TEXT NOT NULL,
      description       TEXT,
      state             TEXT NOT NULL DEFAULT 'todo',
      priority          INTEGER NOT NULL DEFAULT 3,
      source            TEXT NOT NULL DEFAULT 'dashboard',
      parent_task_id    TEXT REFERENCES tasks(id),
      created_by        TEXT NOT NULL DEFAULT 'ceo',
      linear_issue_key  TEXT,
      created_at        INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      completed_at      INTEGER,
      handoff_summary   TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_state ON tasks(state, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_task_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id, state, created_at DESC);

    CREATE TABLE IF NOT EXISTS task_events (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id    TEXT NOT NULL REFERENCES tasks(id),
      role       TEXT,
      type       TEXT NOT NULL,
      payload    TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_task_events_task_created ON task_events(task_id, created_at ASC);

    CREATE TABLE IF NOT EXISTS task_comments (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id    TEXT NOT NULL REFERENCES tasks(id),
      author     TEXT NOT NULL,
      body       TEXT NOT NULL,
      parent_id  INTEGER REFERENCES task_comments(id),
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_task_comments_task ON task_comments(task_id, created_at ASC);
  `);

  // Migrate existing sessions table: add task_id column if missing
  const columns = db.prepare("PRAGMA table_info(sessions)").all() as Array<{ name: string }>;
  if (!columns.some(c => c.name === 'task_id')) {
    db.prepare("ALTER TABLE sessions ADD COLUMN task_id TEXT").run();
    db.prepare("CREATE INDEX IF NOT EXISTS idx_sessions_task ON sessions(task_id)").run();
  }

  // Seed built-in 'system' project for standing duties
  db.prepare(`INSERT OR IGNORE INTO projects (id, name, description, color, icon, state)
              VALUES ('system', 'System', 'Standing duties and system tasks', '#6b7280', '⚙️', 'active')`).run();

  // Backfill: for each session without a task_id, create a task row and link it
  const orphans = db.prepare("SELECT * FROM sessions WHERE task_id IS NULL").all() as Array<Record<string, unknown>>;
  if (orphans.length > 0) {
    const insertTask = db.prepare(`
      INSERT OR IGNORE INTO tasks (id, title, state, priority, source, created_by, created_at)
      VALUES (?, ?, ?, ?, 'duty', 'system', ?)
    `);
    const linkSession = db.prepare("UPDATE sessions SET task_id = ? WHERE issue_key = ?");
    const tx = db.transaction(() => {
      for (const s of orphans) {
        const issueKey = s.issue_key as string;
        const taskId = `migrated-${issueKey}`;
        const sessionState = s.state as string;
        const taskState =
          sessionState === 'active' ? 'running'
          : sessionState === 'idle' ? 'done'
          : sessionState;
        insertTask.run(taskId, issueKey, taskState, s.priority as number, s.spawned_at as number);
        linkSession.run(taskId, issueKey);
      }
    });
    tx();
  }

  return db;
}

/** Test helper: close current DB handle so next getDb() reopens from env var path. */
export function _resetDb(): void {
  if (db) {
    try { db.close(); } catch { /**/ }
    db = null;
  }
}

// --- Session persistence ---

export function saveSessions(sessions: TrackedSession[]): void {
  const d = getDb();
  const upsert = d.prepare(`
    INSERT OR REPLACE INTO sessions
    (issue_key, role, tmux_session, state, spawned_at, suspended_at, idle_since,
     priority, ceo_assigned, handoff_processed, use_continue, is_duty, task_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const tx = d.transaction(() => {
    for (const s of sessions) {
      upsert.run(
        s.issueKey, s.role, s.tmuxSession, s.state, s.spawnedAt,
        s.suspendedAt ?? null, s.idleSince ?? null, s.priority,
        s.ceoAssigned ? 1 : 0, s.handoffProcessed ? 1 : 0,
        s.useContinue ? 1 : 0, s.isDuty ? 1 : 0,
        s.taskId ?? null,
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
    taskId: (r.task_id as string | null) ?? undefined,
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
    const backupPath = resolveDbPath() + '.bak';
    db.backup(backupPath);
  } catch (err) {
    log.warn(`DB backup error: ${(err as Error).message}`);
  }
}
