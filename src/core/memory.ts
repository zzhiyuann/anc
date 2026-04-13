/**
 * Agent memory file CRUD — read, write, delete persona memory files.
 *
 * All operations are jailed to ~/.anc/agents/<role>/memory/ (or whatever
 * stateDir is configured). Filenames are validated against a strict allow-list
 * to prevent path traversal: only [a-zA-Z0-9_.-] and a `.md`/`.txt`/`.json`
 * suffix is permitted. The resolved absolute path is asserted to start with
 * the jail directory before any filesystem call.
 */

import { promises as fs } from 'node:fs';
import { existsSync, mkdirSync, statSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';

const ROLE_RE = /^[a-z0-9_-]+$/;
const FILENAME_RE = /^[A-Za-z0-9_.-]+$/;

function getStateDir(): string {
  // ANC_STATE_DIR override is honoured for test isolation. Otherwise use the
  // canonical ~/.anc location used by linear/types getConfig().
  return process.env.ANC_STATE_DIR || path.join(homedir(), '.anc');
}

function memoryDir(role: string): string {
  if (!ROLE_RE.test(role)) {
    throw new Error(`invalid role slug: ${role}`);
  }
  const dir = path.resolve(path.join(getStateDir(), 'agents', role, 'memory'));
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function safeFile(role: string, filename: string): string {
  if (typeof filename !== 'string' || filename.length === 0) {
    throw new Error('filename required');
  }
  if (filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
    throw new Error('invalid filename');
  }
  if (!FILENAME_RE.test(filename)) {
    throw new Error('invalid filename');
  }
  if (!/\.(md|txt|json)$/i.test(filename)) {
    throw new Error('filename must end in .md, .txt, or .json');
  }
  const dir = memoryDir(role);
  const resolved = path.resolve(path.join(dir, filename));
  // Jail check: defence in depth.
  if (!resolved.startsWith(dir + path.sep)) {
    throw new Error('path escape detected');
  }
  return resolved;
}

export interface MemoryFile {
  filename: string;
  body: string;
  mtime: number;
}

export async function readMemoryFile(role: string, filename: string): Promise<MemoryFile | null> {
  const p = safeFile(role, filename);
  if (!existsSync(p)) return null;
  const body = await fs.readFile(p, 'utf-8');
  const stat = statSync(p);
  return { filename, body, mtime: stat.mtimeMs };
}

export async function writeMemoryFile(role: string, filename: string, body: string): Promise<MemoryFile> {
  if (typeof body !== 'string') throw new Error('body must be string');
  const p = safeFile(role, filename);
  await fs.writeFile(p, body, 'utf-8');
  const stat = statSync(p);
  return { filename, body, mtime: stat.mtimeMs };
}

export async function deleteMemoryFile(role: string, filename: string): Promise<boolean> {
  const p = safeFile(role, filename);
  if (!existsSync(p)) return false;
  await fs.unlink(p);
  return true;
}

export function listMemoryFiles(role: string): string[] {
  const dir = memoryDir(role);
  try {
    return readdirSync(dir).filter((f) => /\.(md|txt|json)$/i.test(f));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Cross-agent memory search + index
// ---------------------------------------------------------------------------

const SHARED_MEMORY_DIR_NAME = 'shared-memory';

function sharedMemoryDir(): string {
  const dir = path.resolve(path.join(getStateDir(), SHARED_MEMORY_DIR_NAME));
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

/** List all agent role slugs that have a memory directory */
function discoverAgentRoles(): string[] {
  const agentsDir = path.join(getStateDir(), 'agents');
  if (!existsSync(agentsDir)) return [];
  try {
    return readdirSync(agentsDir).filter((name) => {
      if (!ROLE_RE.test(name)) return false;
      const memDir = path.join(agentsDir, name, 'memory');
      try { return statSync(memDir).isDirectory(); } catch { return false; }
    });
  } catch {
    return [];
  }
}

export interface MemorySearchResult {
  role: string; // agent role slug or "shared"
  filename: string;
  snippet: string; // ~30 chars around match
  matchType: 'filename' | 'content' | 'both';
}

/**
 * Search all memory files across all agents + shared.
 * Simple case-insensitive substring match. Filename match ranks higher.
 * Returns top `limit` results.
 */
export function searchMemory(query: string, limit = 10): MemorySearchResult[] {
  if (!query || typeof query !== 'string') return [];
  const q = query.toLowerCase();

  const results: (MemorySearchResult & { _score: number })[] = [];

  // Helper: scan a directory of .md/.txt/.json files
  function scanDir(dir: string, role: string): void {
    let files: string[];
    try { files = readdirSync(dir).filter((f) => /\.(md|txt|json)$/i.test(f)); }
    catch { return; }

    for (const filename of files) {
      const filenameMatch = filename.toLowerCase().includes(q);
      let contentSnippet = '';
      let contentMatch = false;

      const fp = path.join(dir, filename);
      try {
        const body = readFileSync(fp, 'utf-8');
        const idx = body.toLowerCase().indexOf(q);
        if (idx >= 0) {
          contentMatch = true;
          const start = Math.max(0, idx - 15);
          const end = Math.min(body.length, idx + q.length + 15);
          contentSnippet = (start > 0 ? '...' : '') +
            body.slice(start, end).replace(/\n/g, ' ') +
            (end < body.length ? '...' : '');
        }
      } catch { /* unreadable file */ }

      if (!filenameMatch && !contentMatch) continue;

      const matchType: MemorySearchResult['matchType'] =
        filenameMatch && contentMatch ? 'both' :
        filenameMatch ? 'filename' : 'content';

      const snippet = contentSnippet || filename;
      const score = matchType === 'both' ? 3 : matchType === 'filename' ? 2 : 1;

      results.push({ role, filename, snippet, matchType, _score: score });
    }
  }

  // Scan all agents
  for (const role of discoverAgentRoles()) {
    const dir = path.join(getStateDir(), 'agents', role, 'memory');
    scanDir(dir, role);
  }

  // Scan shared memory
  const sharedDir = sharedMemoryDir();
  scanDir(sharedDir, 'shared');

  // Sort: higher score first, then alphabetical by role+filename
  results.sort((a, b) =>
    b._score - a._score ||
    a.role.localeCompare(b.role) ||
    a.filename.localeCompare(b.filename)
  );

  return results.slice(0, limit).map(({ _score, ...rest }) => rest);
}

export interface MemoryIndexAgent {
  files: string[];
  totalSize: number;
}

export interface MemoryIndex {
  agents: Record<string, MemoryIndexAgent>;
  shared: MemoryIndexAgent;
}

/** Build a structured map of all agents' memory files + shared memory */
export function getMemoryIndex(): MemoryIndex {
  const agents: Record<string, MemoryIndexAgent> = {};

  for (const role of discoverAgentRoles()) {
    const dir = path.join(getStateDir(), 'agents', role, 'memory');
    let files: string[];
    try { files = readdirSync(dir).filter((f) => /\.(md|txt|json)$/i.test(f)); }
    catch { continue; }
    let totalSize = 0;
    for (const f of files) {
      try { totalSize += statSync(path.join(dir, f)).size; } catch { /* skip */ }
    }
    agents[role] = { files, totalSize };
  }

  // Shared
  const sharedDir = sharedMemoryDir();
  let sharedFiles: string[];
  try { sharedFiles = readdirSync(sharedDir).filter((f) => /\.(md|txt|json)$/i.test(f)); }
  catch { sharedFiles = []; }
  let sharedSize = 0;
  for (const f of sharedFiles) {
    try { sharedSize += statSync(path.join(sharedDir, f)).size; } catch { /* skip */ }
  }

  return { agents, shared: { files: sharedFiles, totalSize: sharedSize } };
}

/** Read a shared memory file by filename (safe, read-only) */
export function readSharedMemoryFile(filename: string): MemoryFile | null {
  if (typeof filename !== 'string' || filename.length === 0) return null;
  if (filename.includes('/') || filename.includes('\\') || filename.includes('..')) return null;
  if (!FILENAME_RE.test(filename)) return null;

  const dir = sharedMemoryDir();
  const fp = path.resolve(path.join(dir, filename));
  if (!fp.startsWith(dir + path.sep) && fp !== dir) return null;
  if (!existsSync(fp)) return null;

  try {
    const body = readFileSync(fp, 'utf-8');
    const stat = statSync(fp);
    return { filename, body, mtime: stat.mtimeMs };
  } catch {
    return null;
  }
}
