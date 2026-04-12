// -- Wave 2B: Claude Code hook handler tests --
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { existsSync, readFileSync, readdirSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  processHookEvent,
  mapToAncEventType,
  buildPreview,
  ensureHookToken,
  initSpillDir,
  _internals,
  type ClaudeHookEvent,
} from '../src/api/hook-handler.js';
import { _setDbForTesting } from '../src/core/db.js';
import { bus } from '../src/bus.js';

// In-memory SQLite isolated from the real ~/.anc/state.db
let testDb: Database.Database;

function freshDb(): Database.Database {
  const d = new Database(':memory:');
  d.exec(`
    CREATE TABLE task_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      role TEXT NOT NULL,
      type TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  return d;
}

beforeEach(() => {
  testDb = freshDb();
  _setDbForTesting(testDb);
  initSpillDir();
});

afterAll(() => {
  _setDbForTesting(null);
});

// --- mapToAncEventType ---

describe('mapToAncEventType', () => {
  it('maps PreToolUse to tool-call-start', () => {
    expect(mapToAncEventType({ hook_event_name: 'PreToolUse', tool_name: 'Bash' })).toBe('agent:tool-call-start');
  });

  it('maps PostToolUse/Bash to bash-command', () => {
    expect(mapToAncEventType({ hook_event_name: 'PostToolUse', tool_name: 'Bash' })).toBe('agent:bash-command');
  });

  it('maps PostToolUse/Read to file-read', () => {
    expect(mapToAncEventType({ hook_event_name: 'PostToolUse', tool_name: 'Read' })).toBe('agent:file-read');
  });

  it('maps PostToolUse/Edit, Write, MultiEdit to file-edit', () => {
    expect(mapToAncEventType({ hook_event_name: 'PostToolUse', tool_name: 'Edit' })).toBe('agent:file-edit');
    expect(mapToAncEventType({ hook_event_name: 'PostToolUse', tool_name: 'Write' })).toBe('agent:file-edit');
    expect(mapToAncEventType({ hook_event_name: 'PostToolUse', tool_name: 'MultiEdit' })).toBe('agent:file-edit');
  });

  it('maps PostToolUse with unknown tool to tool-call-end', () => {
    expect(mapToAncEventType({ hook_event_name: 'PostToolUse', tool_name: 'Foo' })).toBe('agent:tool-call-end');
  });

  it('maps UserPromptSubmit, Stop, SessionEnd, Notification', () => {
    expect(mapToAncEventType({ hook_event_name: 'UserPromptSubmit' })).toBe('agent:prompt-submitted');
    expect(mapToAncEventType({ hook_event_name: 'Stop' })).toBe('agent:session-stop');
    expect(mapToAncEventType({ hook_event_name: 'SessionEnd' })).toBe('agent:session-end');
    expect(mapToAncEventType({ hook_event_name: 'Notification' })).toBe('agent:notification');
  });

  it('falls back to agent:hook-<name> for unknown hook events', () => {
    expect(mapToAncEventType({ hook_event_name: 'WeirdNew' as never })).toBe('agent:hook-WeirdNew');
  });
});

// --- buildPreview ---

describe('buildPreview', () => {
  it('renders Bash command preview', () => {
    const p = buildPreview({
      hook_event_name: 'PostToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'ls -la /tmp' },
    });
    expect(p).toContain('Bash:');
    expect(p).toContain('ls -la /tmp');
  });

  it('renders file path tail for Read/Edit/Write', () => {
    const p = buildPreview({
      hook_event_name: 'PostToolUse',
      tool_name: 'Edit',
      tool_input: { file_path: '/Users/x/projects/anc/src/api/hook-handler.ts' },
    });
    expect(p).toBe('Edit: api/hook-handler.ts');
  });

  it('renders prompt prefix for UserPromptSubmit', () => {
    const p = buildPreview({ hook_event_name: 'UserPromptSubmit', prompt: 'do the thing please' });
    expect(p).toContain('Prompt:');
    expect(p).toContain('do the thing');
  });

  it('truncates long previews', () => {
    const p = buildPreview({
      hook_event_name: 'PostToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'x'.repeat(500) },
    });
    expect(p.length).toBeLessThanOrEqual(100);
    expect(p.endsWith('…')).toBe(true);
  });
});

// --- processHookEvent ---

describe('processHookEvent', () => {
  it('inserts a task_events row with the correct type', () => {
    const evt: ClaudeHookEvent = { hook_event_name: 'PreToolUse', tool_name: 'Read' };
    const res = processHookEvent('RYA-1', 'engineer', evt);
    expect(res.ok).toBe(true);
    expect(res.eventType).toBe('agent:tool-call-start');

    const row = testDb.prepare('SELECT * FROM task_events WHERE task_id = ?').get('RYA-1') as Record<string, unknown>;
    expect(row).toBeTruthy();
    expect(row.role).toBe('engineer');
    expect(row.type).toBe('agent:tool-call-start');
    const payload = JSON.parse(row.payload as string);
    expect(payload.tool_name).toBe('Read');
  });

  it('emits agent:process-event on the bus with preview', async () => {
    const seen: Array<{ taskId: string; role: string; eventType: string; preview: string }> = [];
    const off = bus.on('agent:process-event', (e) => { seen.push(e); });

    processHookEvent('RYA-2', 'ops', {
      hook_event_name: 'PostToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'echo hello' },
    });

    // bus.emit is async but resolves quickly; give microtasks a tick
    await new Promise((r) => setImmediate(r));

    off();
    expect(seen).toHaveLength(1);
    expect(seen[0].taskId).toBe('RYA-2');
    expect(seen[0].role).toBe('ops');
    expect(seen[0].eventType).toBe('agent:bash-command');
    expect(seen[0].preview).toContain('echo hello');
  });

  it('spills oversized payloads to file and stores a reference stub', () => {
    const big = 'A'.repeat(_internals.INLINE_MAX_BYTES + 1024);
    const res = processHookEvent('RYA-spill', 'engineer', {
      hook_event_name: 'PostToolUse',
      tool_name: 'Read',
      tool_response: big,
    });
    expect(res.ok).toBe(true);
    expect(res.spilled).toBe(true);

    const row = testDb.prepare('SELECT payload FROM task_events WHERE task_id = ?').get('RYA-spill') as { payload: string };
    const stub = JSON.parse(row.payload);
    expect(stub._spilled).toBe(true);
    expect(typeof stub.size).toBe('number');

    if (stub.file) {
      const path = join(_internals.SPILL_DIR, stub.file);
      expect(existsSync(path)).toBe(true);
      const content = JSON.parse(readFileSync(path, 'utf8'));
      expect(content.tool_response).toBe(big);
      // cleanup
      try { rmSync(path); } catch { /**/ }
    }
  });

  it('keeps small payloads inline (no spill)', () => {
    const res = processHookEvent('RYA-small', 'engineer', {
      hook_event_name: 'PreToolUse',
      tool_name: 'Glob',
    });
    expect(res.spilled).toBe(false);
    const row = testDb.prepare('SELECT payload FROM task_events WHERE task_id = ?').get('RYA-small') as { payload: string };
    const parsed = JSON.parse(row.payload);
    expect(parsed._spilled).toBeUndefined();
    expect(parsed.tool_name).toBe('Glob');
  });

  it('handles unknown hook_event_name gracefully', () => {
    const res = processHookEvent('RYA-x', 'strategist', { hook_event_name: 'MysteryEvent' });
    expect(res.ok).toBe(true);
    expect(res.eventType).toBe('agent:hook-MysteryEvent');
  });

  it('handles null payload without crashing', () => {
    const res = processHookEvent('RYA-null', 'engineer', null);
    expect(res.ok).toBe(true);
    expect(res.eventType).toBe('agent:hook-unknown');
  });
});

// --- ensureHookToken ---

describe('ensureHookToken', () => {
  it('returns a stable token across calls', () => {
    delete process.env.ANC_HOOK_TOKEN;
    // Force-set so we don't pollute the user's real ~/.anc/hook-token in CI
    process.env.ANC_HOOK_TOKEN = 'test-token-fixed';
    const a = ensureHookToken();
    const b = ensureHookToken();
    expect(a).toBe('test-token-fixed');
    expect(b).toBe(a);
  });

  // Wave 2 fix: hook-handler.ts is ESM, so any leftover require() call would
  // throw 'require is not defined' the first time it runs. The fact that the
  // module imported successfully at the top of this file already proves there
  // are no top-level require()s. Exercise ensureHookToken without the env var
  // shortcut to make sure the file-system fallback path also avoids require().
  it('no require() in fallback file-system path (ESM smoke)', () => {
    delete process.env.ANC_HOOK_TOKEN;
    expect(() => ensureHookToken()).not.toThrow();
    // Restore so other tests stay deterministic.
    process.env.ANC_HOOK_TOKEN = 'test-token-fixed';
  });
});
