/**
 * Agent memory — file-based persistent knowledge.
 * Each agent has its own memory directory. No vector DB, no embedding drift.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { join } from 'path';
import type { AgentRole } from '../linear/types.js';
import { getConfig } from '../linear/types.js';

function getMemoryDir(role: AgentRole): string {
  const config = getConfig();
  const dir = join(config.stateDir, 'agents', role, 'memory');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

/** Read a memory file */
export function readMemory(role: AgentRole, filename: string): string | null {
  const path = join(getMemoryDir(role), filename);
  if (!existsSync(path)) return null;
  return readFileSync(path, 'utf-8');
}

/** Write a memory file */
export function writeMemory(role: AgentRole, filename: string, content: string): void {
  const path = join(getMemoryDir(role), filename);
  writeFileSync(path, content, 'utf-8');
}

/** List all memory files for an agent */
export function listMemories(role: AgentRole): string[] {
  const dir = getMemoryDir(role);
  return readdirSync(dir).filter(f => f.endsWith('.md'));
}

/** Get shared memory directory (cross-agent knowledge) */
function getSharedMemoryDir(): string {
  const config = getConfig();
  const dir = join(config.stateDir, 'shared-memory');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

/** Read shared memory */
export function readSharedMemory(filename: string): string | null {
  const path = join(getSharedMemoryDir(), filename);
  if (!existsSync(path)) return null;
  return readFileSync(path, 'utf-8');
}

/** Write shared memory */
export function writeSharedMemory(filename: string, content: string): void {
  const path = join(getSharedMemoryDir(), filename);
  writeFileSync(path, content, 'utf-8');
}

/** List shared memories */
export function listSharedMemories(): string[] {
  return readdirSync(getSharedMemoryDir()).filter(f => f.endsWith('.md'));
}
