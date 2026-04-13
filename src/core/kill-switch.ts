/**
 * Kill switch — global pause/resume for all agent sessions and the dispatch
 * queue. Surfaced on the /pulse dashboard. Persisted to ~/.anc/kill-switch so
 * the paused state survives a server restart.
 *
 * Note: queue gating is the parent's job (check `isGlobalPaused()` inside the
 * queue dispatcher when wiring this up). This module only owns the pause flag
 * and the bulk-suspend of currently active sessions.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';
import { getTrackedSessions } from '../runtime/health.js';
import { suspendSession } from '../runtime/runner.js';
import { bus } from '../bus.js';
import { createLogger } from './logger.js';

const log = createLogger('kill-switch');

function killSwitchFile(): string {
  return process.env.ANC_KILL_SWITCH_PATH || join(homedir(), '.anc', 'kill-switch');
}

let cached: boolean | null = null;

/** Test helper: clear the in-memory paused flag cache. */
export function _resetKillSwitchCache(): void {
  cached = null;
}

function readFlag(): boolean {
  if (cached !== null) return cached;
  cached = existsSync(killSwitchFile());
  return cached;
}

function writeFlag(paused: boolean): void {
  const path = killSwitchFile();
  const dir = dirname(path);
  if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
  if (paused) {
    writeFileSync(path, new Date().toISOString(), 'utf-8');
  } else if (existsSync(path)) {
    unlinkSync(path);
  }
  cached = paused;
}

export function isGlobalPaused(): boolean {
  return readFlag();
}

export interface PauseResult {
  ok: true;
  alreadyPaused: boolean;
  suspended: number;
  failed: number;
}

export function pauseAll(): PauseResult {
  const wasPaused = isGlobalPaused();
  writeFlag(true);

  const active = getTrackedSessions().filter((s) => s.state === 'active');
  let suspended = 0;
  let failed = 0;
  for (const s of active) {
    try {
      if (suspendSession(s.issueKey)) suspended += 1;
      else failed += 1;
    } catch (err) {
      failed += 1;
      log.warn(`failed to suspend ${s.issueKey}: ${(err as Error).message}`);
    }
  }

  log.info(`kill switch engaged: suspended=${suspended} failed=${failed}`);
  if (!wasPaused) {
    void bus.emit('system:kill-switch-engaged', { suspended, failed });
  }
  return { ok: true, alreadyPaused: wasPaused, suspended, failed };
}

export interface ResumeResult {
  ok: true;
  wasPaused: boolean;
}

export function resume(): ResumeResult {
  const wasPaused = isGlobalPaused();
  writeFlag(false);
  log.info('kill switch released');
  return { ok: true, wasPaused };
}
