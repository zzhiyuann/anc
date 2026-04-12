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

import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { getDb } from '../core/db.js';
import { bus } from '../bus.js';
import { createLogger } from '../core/logger.js';

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

  return { ok: true, eventType, spilled };
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
