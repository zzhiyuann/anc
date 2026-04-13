/**
 * Memory CLI commands — cross-agent knowledge discovery.
 *
 * anc memory search <query>   — search all agents' + shared memory
 * anc memory read @<role> <f> — read another agent's memory file
 * anc memory list [@<role>]   — list memory files for a role (or all)
 */

import {
  searchMemory,
  getMemoryIndex,
  readMemoryFile,
  listMemoryFiles,
  readSharedMemoryFile,
} from '../core/memory.js';

export async function memorySearchCommand(query: string): Promise<void> {
  const results = searchMemory(query);
  if (results.length === 0) {
    console.log(`No results for "${query}".`);
    return;
  }
  console.log(`Results for "${query}":`);
  for (const r of results) {
    const owner = r.role === 'shared' ? '@shared' : `@${r.role}`;
    const matchLabel =
      r.matchType === 'both' ? '(matched in filename + content)' :
      r.matchType === 'filename' ? '(matched in filename)' :
      `(matched in content: "${r.snippet}")`;
    console.log(`  ${owner.padEnd(16)} ${r.filename.padEnd(30)} ${matchLabel}`);
  }
}

export async function memoryReadCommand(target: string, filename?: string): Promise<void> {
  // Parse @role syntax
  const role = target.startsWith('@') ? target.slice(1) : target;

  if (!filename) {
    console.error('Usage: anc memory read @<role> <filename>');
    process.exit(1);
  }

  let result;
  if (role === 'shared') {
    result = readSharedMemoryFile(filename);
  } else {
    result = await readMemoryFile(role, filename);
  }

  if (!result) {
    console.error(`Not found: ${role}/${filename}`);
    process.exit(1);
  }

  console.log(result.body);
}

export async function memoryListCommand(target?: string): Promise<void> {
  if (target) {
    // List specific role
    const role = target.startsWith('@') ? target.slice(1) : target;

    if (role === 'shared') {
      const index = getMemoryIndex();
      if (index.shared.files.length === 0) {
        console.log('No shared memory files.');
        return;
      }
      console.log(`@shared (${index.shared.files.length} files, ${index.shared.totalSize} bytes):`);
      for (const f of index.shared.files) {
        console.log(`  ${f}`);
      }
      return;
    }

    const files = listMemoryFiles(role);
    if (files.length === 0) {
      console.log(`No memory files for @${role}.`);
      return;
    }
    console.log(`@${role} (${files.length} files):`);
    for (const f of files) {
      console.log(`  ${f}`);
    }
    return;
  }

  // List all agents' memory
  const index = getMemoryIndex();
  const roles = Object.keys(index.agents);
  if (roles.length === 0 && index.shared.files.length === 0) {
    console.log('No memory files found.');
    return;
  }

  for (const role of roles) {
    const info = index.agents[role];
    console.log(`@${role} (${info.files.length} files, ${info.totalSize} bytes):`);
    for (const f of info.files) {
      console.log(`  ${f}`);
    }
  }

  if (index.shared.files.length > 0) {
    console.log(`@shared (${index.shared.files.length} files, ${index.shared.totalSize} bytes):`);
    for (const f of index.shared.files) {
      console.log(`  ${f}`);
    }
  }
}
