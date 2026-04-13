/**
 * Agent memory — file-based persistent knowledge with layered architecture.
 * Each agent has its own memory directory with subdirectories:
 *   strategic/ — core beliefs, slow-changing, always loaded
 *   domain/    — expertise, medium-pace change
 *   project/<slug>/ — project-scoped working memory
 *   retrospectives/ — auto-generated from completed tasks
 *
 * No vector DB, no embedding drift.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { join } from 'path';
import type { AgentRole } from '../linear/types.js';
import { getConfig } from '../linear/types.js';
import type { MemoryLayer } from './persona.js';

function getMemoryDir(role: AgentRole): string {
  const config = getConfig();
  const dir = join(config.stateDir, 'agents', role, 'memory');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function getLayerDir(role: AgentRole, layer: MemoryLayer, project?: string): string {
  const base = getMemoryDir(role);
  let dir: string;
  if (layer === 'project') {
    if (!project) throw new Error('project slug required for project layer');
    dir = join(base, 'project', project);
  } else {
    dir = join(base, layer);
  }
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function getRetroDir(role: AgentRole): string {
  const config = getConfig();
  const dir = join(config.stateDir, 'agents', role, 'retrospectives');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

/** Read a memory file (backward-compat: also checks flat dir) */
export function readMemory(role: AgentRole, filename: string): string | null {
  // Try layered paths first
  for (const sub of ['strategic', 'domain']) {
    const path = join(getMemoryDir(role), sub, filename);
    if (existsSync(path)) return readFileSync(path, 'utf-8');
  }
  // Try flat (backward compat)
  const flat = join(getMemoryDir(role), filename);
  if (existsSync(flat)) return readFileSync(flat, 'utf-8');
  return null;
}

/** Write a memory file to a specific layer */
export function writeMemory(
  role: AgentRole,
  filename: string,
  content: string,
  layer: MemoryLayer = 'domain',
  project?: string,
): void {
  const dir = getLayerDir(role, layer, project);
  const path = join(dir, filename);
  writeFileSync(path, content, 'utf-8');
}

/** Write a retrospective file */
export function writeRetrospective(role: AgentRole, filename: string, content: string): void {
  const dir = getRetroDir(role);
  const path = join(dir, filename);
  writeFileSync(path, content, 'utf-8');
}

/** List all memory files for an agent (layered + flat) */
export function listMemories(role: AgentRole): string[] {
  const base = getMemoryDir(role);
  const results: string[] = [];

  // Layered subdirs
  for (const sub of ['strategic', 'domain']) {
    const subDir = join(base, sub);
    if (existsSync(subDir)) {
      for (const f of readdirSync(subDir).filter(f => f.endsWith('.md'))) {
        results.push(`${sub}/${f}`);
      }
    }
  }

  // Project subdirs
  const projectDir = join(base, 'project');
  if (existsSync(projectDir)) {
    for (const proj of readdirSync(projectDir)) {
      const projDir = join(projectDir, proj);
      try {
        if (!existsSync(projDir)) continue;
        for (const f of readdirSync(projDir).filter(f => f.endsWith('.md'))) {
          results.push(`project/${proj}/${f}`);
        }
      } catch { /* skip */ }
    }
  }

  // Flat files (backward compat)
  for (const f of readdirSync(base).filter(f => f.endsWith('.md'))) {
    results.push(f);
  }

  return results;
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
