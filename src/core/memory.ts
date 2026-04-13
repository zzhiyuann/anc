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
import { existsSync, mkdirSync, statSync, readdirSync } from 'node:fs';
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
