/**
 * Global vitest setup — runs once per worker, before any test imports.
 *
 * Pins ANC_DB_PATH to a per-process temp file so tests never read or mutate
 * the developer's real ~/.anc/state.db. Individual test files can still
 * override ANC_DB_PATH (e.g., pulse.test.ts sets its own); this only fires
 * if the env var is not already set.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll } from 'vitest';

if (!process.env.ANC_DB_PATH) {
  const dir = mkdtempSync(join(tmpdir(), `anc-vitest-${process.pid}-`));
  process.env.ANC_DB_PATH = join(dir, 'state.db');

  afterAll(() => {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /**/ }
  });
}
