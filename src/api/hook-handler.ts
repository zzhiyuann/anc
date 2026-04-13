// -- Wave 2B: Claude Code hook handler --
/**
 * Claude Code hooks integration for ANC process capture.
 *
 * What:  Claude Code emits hook events (PreToolUse, PostToolUse, UserPromptSubmit,
 *        Stop, SessionEnd, Notification) for each step the agent takes inside a
 *        session. These are configured via .claude/settings.local.json — see
 *        src/runtime/workspace.ts:writeAutoModeSettings().
 *
 * Why:   The ANC dashboard needs a fine-grained "process stream" of what each
 *        agent is doing in real time (tools used, files touched, bash commands,
 *        prompts submitted). Claude Code's native hooks are the cleanest way to
 *        capture this — no PTY scraping, no log tailing, structured JSON.
 *
 * How:   Each hook fires a small `curl` POST to ANC's gateway endpoint
 *        (POST /api/v1/hooks/:taskId/event) carrying the raw hook payload on
 *        stdin. This handler classifies it into a normalized ANC event type,
 *        persists to the `task_events` table, and emits `agent:process-event`
 *        on the bus so the WebSocket layer can broadcast to the dashboard.
 *
 * Auth:  A shared secret `ANC_HOOK_TOKEN` (lazy-generated and stored at
 *        ~/.anc/hook-token) is passed as a Bearer token by the curl hook.
 *        Hook traffic is local-only (loopback). The agent role is forwarded
 *        in the X-ANC-Agent-Role header so we can attribute events.
 *
 * Spill: Hook payloads can be large (full file contents on Read, full bash
 *        output on Bash). Anything over INLINE_MAX_BYTES is written to
 *        ~/.anc/process-capture/<taskId>-<uuid>.json and the row stores a
 *        small reference stub `{_spilled: true, file, size}`. The dashboard
 *        can fetch the spill file on demand.
 */

import { writeFileSync, mkdirSync, existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { getDb } from '../core/db.js';
import { bus } from '../bus.js';
import { createLogger } from '../core/logger.js';
import { recordSpend } from '../core/budget.js';
import { computeCost, totalTokens, type TokenUsage } from '../core/pricing.js';

const log = createLogger('hook');

const SPILL_DIR = join(homedir(), '.anc', 'process-capture');
const INLINE_MAX_BYTES = 8192;

export type ClaudeHookEventName =
  | 'PreToolUse'
  | 'PostToolUse'
  | 'UserPromptSubmit'
  | 'Stop'
  | 'SessionEnd'
  | 'Notification';

export interface ClaudeHookEvent {
  hook_event_name: ClaudeHookEventName | string;
  tool_name?: string;
  tool_input?: unknown;
  tool_response?: unknown;
  prompt?: string;
  message?: string;
  [key: string]: unknown;
}

/** Initialize spill directory. Safe to call multiple times. */
export function initSpillDir(): void {
  try {
    mkdirSync(SPILL_DIR, { recursive: true });
  } catch {
    /* ignore */
  }
}

/**
 * Process a single Claude Code hook payload:
 *   1. classify → ANC event type
 *   2. serialize, spill if oversized
 *   3. insert into task_events
 *   4. emit agent:process-event on the bus
 */
export function processHookEvent(
  taskId: string,
  role: string,
  rawPayload: unknown,
): { ok: boolean; eventType: string; spilled: boolean } {
  const event = (rawPayload ?? {}) as ClaudeHookEvent;
  const eventType = mapToAncEventType(event);

  const json = JSON.stringify(event);
  let storedPayload: string;
  let spilled = false;

  if (Buffer.byteLength(json, 'utf8') > INLINE_MAX_BYTES) {
    spilled = true;
    const filename = `${taskId}-${randomUUID()}.json`;
    const filepath = join(SPILL_DIR, filename);
    try {
      // Best-effort: ensure dir exists in case startup init was skipped (tests).
      try { mkdirSync(SPILL_DIR, { recursive: true }); } catch { /**/ }
      writeFileSync(filepath, json, 'utf8');
      storedPayload = JSON.stringify({ _spilled: true, file: filename, size: json.length });
    } catch (err) {
      log.warn(`Spill write failed: ${(err as Error).message}`);
      storedPayload = JSON.stringify({ _spilled: true, error: 'failed to spill', size: json.length });
    }
  } else {
    storedPayload = json;
  }

  try {
    getDb()
      .prepare(`INSERT INTO task_events (task_id, role, type, payload) VALUES (?, ?, ?, ?)`)
      .run(taskId, role, eventType, storedPayload);
  } catch (err) {
    log.error(`Failed to insert hook event: ${(err as Error).message}`);
    return { ok: false, eventType, spilled };
  }

  void bus.emit('agent:process-event', {
    taskId,
    role,
    eventType,
    preview: buildPreview(event),
  });

  // Cost ingestion: on session-end events, parse the transcript JSONL to
  // extract token usage and write it to budget_log via recordSpend.
  // Best-effort — failures here must not break event capture.
  if (event.hook_event_name === 'Stop' || event.hook_event_name === 'SessionEnd') {
    try {
      ingestSessionCost(taskId, role, event);
    } catch (err) {
      log.warn(`cost ingestion failed for ${taskId}: ${(err as Error).message}`);
    }
  }

  return { ok: true, eventType, spilled };
}

/**
 * Extract token usage from a Claude Code transcript JSONL and record spend.
 *
 * Strategy A (v1): on Stop/SessionEnd, read the entire transcript, sum all
 * usage{} blocks attached to assistant messages, compute cost via the model
 * indicated on the most recent assistant message, then call recordSpend once.
 *
 * Future improvement (Strategy B): incrementally tally usage on every
 * PostToolUse using a per-session offset so partial sessions also bill.
 */
export function ingestSessionCost(
  taskId: string,
  role: string,
  event: ClaudeHookEvent,
): { tokens: number; cost: number; model: string | null } | null {
  const transcriptPath =
    (event as { transcript_path?: string }).transcript_path ??
    (event as { transcriptPath?: string }).transcriptPath;
  if (!transcriptPath || typeof transcriptPath !== 'string') {
    log.debug(`no transcript_path on ${event.hook_event_name} for ${taskId}`);
    return null;
  }
  if (!existsSync(transcriptPath)) {
    log.debug(`transcript missing at ${transcriptPath}`);
    return null;
  }
  // Avoid blowing memory on huge transcripts (>50 MB → skip).
  try {
    const sz = statSync(transcriptPath).size;
    if (sz > 50 * 1024 * 1024) {
      log.warn(`transcript too large (${sz} bytes) — skipping cost ingestion for ${taskId}`);
      return null;
    }
  } catch { /* ignore */ }

  const usage = parseTranscriptUsage(transcriptPath);
  if (!usage) return null;

  const tokens = totalTokens(usage.usage);
  const cost = computeCost(usage.model, usage.usage);
  if (tokens === 0 && cost === 0) {
    log.debug(`no usage found in transcript for ${taskId}`);
    return null;
  }

  // Resolve issue_key for the budget_log row. Hook taskId may be a task UUID
  // or a legacy issueKey. Look up sessions table by task_id first; fall back
  // to using taskId itself (covers the legacy single-session shape).
  const issueKey = resolveIssueKey(taskId);

  // Ensure a sessions row exists for this task so the API cost aggregator
  // (routes.ts → buildTaskDetail) can find it. The in-memory health tracker
  // never persists to SQLite, so without this no row exists at query time.
  ensureSessionRow(taskId, role, issueKey);

  try {
    recordSpend(role, issueKey, tokens, cost);
    log.info(
      `cost ingested ${role}/${issueKey}: ${tokens} tokens, $${cost.toFixed(4)} (model=${usage.model ?? 'unknown'})`,
    );
  } catch (err) {
    log.error(`recordSpend failed: ${(err as Error).message}`);
    return null;
  }

  return { tokens, cost, model: usage.model };
}

/**
 * Parse a Claude Code transcript JSONL file and return aggregate token usage.
 * Each line is a JSON object; assistant entries carry a `message.usage` field.
 * The `message.model` of the latest assistant entry is used for pricing.
 */
export function parseTranscriptUsage(
  path: string,
): { usage: TokenUsage; model: string | null } | null {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    log.warn(`failed to read transcript ${path}: ${(err as Error).message}`);
    return null;
  }
  const lines = raw.split('\n').filter(l => l.trim().length > 0);
  const usage: TokenUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  let model: string | null = null;
  let found = false;

  for (const line of lines) {
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    // Claude Code transcripts wrap the actual API message under `.message`.
    // The role lives either at top level or inside .message.
    const message = (obj.message ?? obj) as Record<string, unknown>;
    const role = (message.role ?? obj.role) as string | undefined;
    if (role !== 'assistant') continue;

    const u = message.usage as
      | {
          input_tokens?: number;
          output_tokens?: number;
          cache_read_input_tokens?: number;
          cache_creation_input_tokens?: number;
        }
      | undefined;
    if (!u) continue;

    usage.input += u.input_tokens ?? 0;
    usage.output += u.output_tokens ?? 0;
    usage.cacheRead += u.cache_read_input_tokens ?? 0;
    usage.cacheWrite += u.cache_creation_input_tokens ?? 0;
    if (typeof message.model === 'string') model = message.model;
    found = true;
  }

  if (!found) return null;
  return { usage, model };
}

/**
 * Persist (or upsert) a sessions row for this task so cost aggregation in
 * routes.ts can join budget_log → sessions → task. The in-memory health
 * tracker never writes to SQLite for the dashboard task path; without this
 * the cost field on TaskFull stays empty even though budget_log has rows.
 */
function ensureSessionRow(taskId: string, role: string, issueKey: string): void {
  try {
    const db = getDb();
    db.prepare(
      `INSERT OR IGNORE INTO sessions
         (issue_key, role, tmux_session, state, spawned_at, task_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(issueKey, role, `anc-${role}-${taskId}`, 'idle', Date.now(), taskId);
  } catch (err) {
    log.debug(`ensureSessionRow skipped: ${(err as Error).message}`);
  }
}

/** Resolve an incoming hook taskId to the issue_key used in budget_log. */
function resolveIssueKey(taskId: string): string {
  try {
    const row = getDb()
      .prepare('SELECT issue_key FROM sessions WHERE task_id = ? OR issue_key = ? LIMIT 1')
      .get(taskId, taskId) as { issue_key?: string } | undefined;
    if (row?.issue_key) return row.issue_key;
  } catch {
    /* sessions table may not exist in some test DBs */
  }
  return taskId;
}

/** Pure: classify a Claude hook payload into a normalized ANC event type. */
export function mapToAncEventType(event: ClaudeHookEvent): string {
  switch (event.hook_event_name) {
    case 'PreToolUse':
      return 'agent:tool-call-start';
    case 'PostToolUse': {
      const tool = event.tool_name ?? '';
      if (tool === 'Read') return 'agent:file-read';
      if (tool === 'Edit' || tool === 'Write' || tool === 'MultiEdit') return 'agent:file-edit';
      if (tool === 'Bash') return 'agent:bash-command';
      return 'agent:tool-call-end';
    }
    case 'UserPromptSubmit':
      return 'agent:prompt-submitted';
    case 'Stop':
      return 'agent:session-stop';
    case 'SessionEnd':
      return 'agent:session-end';
    case 'Notification':
      return 'agent:notification';
    default:
      return `agent:hook-${event.hook_event_name ?? 'unknown'}`;
  }
}

/** Pure: build a short single-line preview string for the dashboard UI. */
export function buildPreview(event: ClaudeHookEvent): string {
  const tool = event.tool_name;
  const name = event.hook_event_name;

  if (name === 'PreToolUse' && tool) return truncate(`Starting ${tool}`);
  if (name === 'PostToolUse' && tool) {
    if (tool === 'Bash') {
      const cmd = (event.tool_input as { command?: string } | undefined)?.command ?? '';
      return truncate(`Bash: ${cmd}`);
    }
    if (tool === 'Read' || tool === 'Edit' || tool === 'Write' || tool === 'MultiEdit') {
      const file = (event.tool_input as { file_path?: string } | undefined)?.file_path ?? '';
      const tail = file.split('/').slice(-2).join('/');
      return truncate(`${tool}: ${tail}`);
    }
    return truncate(`${tool} complete`);
  }
  if (name === 'UserPromptSubmit') {
    return truncate(`Prompt: ${event.prompt ?? ''}`);
  }
  if (name === 'Notification') {
    return truncate(`Notification: ${event.message ?? ''}`);
  }
  return truncate(String(name ?? 'hook-event'));
}

function truncate(s: string, max = 100): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

// --- Auth token management ---

/**
 * Lazy-generate (and cache) the shared hook token.
 * Token lives at ~/.anc/hook-token, persists across restarts so existing
 * settings.local.json files keep working. Also exported via process.env
 * for the gateway endpoint to compare against.
 */
export function ensureHookToken(): string {
  if (process.env.ANC_HOOK_TOKEN) return process.env.ANC_HOOK_TOKEN;

  const tokenPath = join(homedir(), '.anc', 'hook-token');
  try {
    if (existsSync(tokenPath)) {
      const existing = readFileSync(tokenPath, 'utf8').trim();
      if (existing) {
        process.env.ANC_HOOK_TOKEN = existing;
        return existing;
      }
    }
  } catch { /**/ }

  const fresh = randomUUID().replace(/-/g, '');
  try {
    mkdirSync(join(homedir(), '.anc'), { recursive: true });
    writeFileSync(tokenPath, fresh, { mode: 0o600 });
  } catch (err) {
    log.warn(`Failed to persist hook token: ${(err as Error).message}`);
  }
  process.env.ANC_HOOK_TOKEN = fresh;
  return fresh;
}

/** @internal exported for testing */
export const _internals = { SPILL_DIR, INLINE_MAX_BYTES };
