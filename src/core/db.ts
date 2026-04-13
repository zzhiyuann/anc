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

    CREATE TABLE IF NOT EXISTS projects (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      description   TEXT,
      color         TEXT NOT NULL DEFAULT '#3b82f6',
      icon          TEXT,
      state         TEXT NOT NULL DEFAULT 'active',
      created_by    TEXT NOT NULL DEFAULT 'ceo',
      created_at    INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      archived_at   INTEGER,
      health        TEXT,
      priority      INTEGER,
      lead          TEXT,
      target_date   TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_projects_state ON projects(state, created_at DESC);

    CREATE TABLE IF NOT EXISTS objectives (
      id          TEXT PRIMARY KEY,
      title       TEXT NOT NULL,
      description TEXT,
      quarter     TEXT NOT NULL,
      created_at  INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_objectives_quarter ON objectives(quarter);

    CREATE TABLE IF NOT EXISTS key_results (
      id           TEXT PRIMARY KEY,
      objective_id TEXT NOT NULL,
      title        TEXT NOT NULL,
      metric       TEXT NOT NULL,
      target       REAL NOT NULL,
      current      REAL NOT NULL DEFAULT 0,
      created_at   INTEGER NOT NULL,
      FOREIGN KEY (objective_id) REFERENCES objectives(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_key_results_objective ON key_results(objective_id);

    CREATE TABLE IF NOT EXISTS decisions (
      id          TEXT PRIMARY KEY,
      title       TEXT NOT NULL,
      rationale   TEXT NOT NULL,
      decided_by  TEXT NOT NULL,
      tags        TEXT NOT NULL DEFAULT '[]',
      created_at  INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_decisions_created_at ON decisions(created_at);

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

    CREATE TABLE IF NOT EXISTS labels (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL UNIQUE,
      color      TEXT NOT NULL DEFAULT '#6b7280',
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
    CREATE TABLE IF NOT EXISTS task_labels (
      task_id  TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      label_id INTEGER NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
      PRIMARY KEY (task_id, label_id)
    );
    CREATE INDEX IF NOT EXISTS idx_task_labels_label ON task_labels(label_id);

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

    CREATE TABLE IF NOT EXISTS notifications (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      kind          TEXT NOT NULL,
      severity      TEXT NOT NULL DEFAULT 'info',
      title         TEXT NOT NULL,
      body          TEXT,
      task_id       TEXT REFERENCES tasks(id),
      project_id    TEXT REFERENCES projects(id),
      agent_role    TEXT,
      read_at       INTEGER,
      archived_at   INTEGER,
      created_at    INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(read_at, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_notifications_task ON notifications(task_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_task_events_task ON task_events(task_id, id DESC);

    CREATE TABLE IF NOT EXISTS task_feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      parent_task_id TEXT NOT NULL,
      child_task_id TEXT NOT NULL,
      summary TEXT,
      delivered INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_task_feedback_parent ON task_feedback(parent_task_id, delivered);

    CREATE TABLE IF NOT EXISTS optimization_experiments (
      id TEXT PRIMARY KEY,
      target TEXT NOT NULL,
      hypothesis TEXT NOT NULL,
      change_json TEXT NOT NULL,
      metric TEXT NOT NULL,
      baseline_value REAL NOT NULL,
      experiment_value REAL,
      status TEXT NOT NULL DEFAULT 'proposed',
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      measured_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_opt_exp_status ON optimization_experiments(status);
  `);

  // Migrate existing tables from TEXT → INTEGER timestamps (idempotent)
  migrateTimestamps(db);

  // Migrate existing sessions table: add task_id column if missing
  const columns = db.prepare("PRAGMA table_info(sessions)").all() as Array<{ name: string }>;
  if (!columns.some(c => c.name === 'task_id')) {
    db.prepare("ALTER TABLE sessions ADD COLUMN task_id TEXT").run();
    db.prepare("CREATE INDEX IF NOT EXISTS idx_sessions_task ON sessions(task_id)").run();
  }

  // Migrate projects table: add Wave B metadata columns if missing
  const projectCols = db.prepare("PRAGMA table_info(projects)").all() as Array<{ name: string }>;
  const haveProjectCols = new Set(projectCols.map(c => c.name));
  for (const [name, type] of [
    ['health', 'TEXT'],
    ['priority', 'INTEGER'],
    ['lead', 'TEXT'],
    ['target_date', 'TEXT'],
  ] as const) {
    if (!haveProjectCols.has(name)) {
      try { db.prepare(`ALTER TABLE projects ADD COLUMN ${name} ${type}`).run(); } catch { /**/ }
    }
  }

  // Migrate tasks table: add assignee + due_date columns if missing
  const taskCols = db.prepare("PRAGMA table_info(tasks)").all() as Array<{ name: string }>;
  if (!taskCols.some(c => c.name === 'assignee')) {
    db.prepare("ALTER TABLE tasks ADD COLUMN assignee TEXT").run();
  }
  if (!taskCols.some(c => c.name === 'due_date')) {
    db.prepare("ALTER TABLE tasks ADD COLUMN due_date TEXT").run();
  }
  if (!taskCols.some(c => c.name === 'progress')) {
    db.prepare("ALTER TABLE tasks ADD COLUMN progress INTEGER DEFAULT 0").run();
  }

  // Seed default labels if labels table is empty
  const labelCount = db.prepare('SELECT COUNT(*) AS c FROM labels').get() as { c: number };
  if (labelCount.c === 0) {
    const insertLabel = db.prepare('INSERT OR IGNORE INTO labels (name, color) VALUES (?, ?)');
    const seed = db.transaction(() => {
      insertLabel.run('bug', '#ef4444');
      insertLabel.run('feature', '#3b82f6');
      insertLabel.run('research', '#8b5cf6');
      insertLabel.run('urgent', '#f59e0b');
    });
    seed();
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

/** Test helper: swap in a pre-opened DB (e.g., :memory: for tests). */
export function _setDbForTesting(testDb: Database.Database | null): void {
  db = testDb;
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
    const backupPath = resolveDbPath() + '.bak';
    db.backup(backupPath);
  } catch (err) {
    log.warn(`DB backup error: ${(err as Error).message}`);
  }
}
