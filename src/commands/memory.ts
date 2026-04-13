/**
 * Memory CLI commands — cross-agent knowledge discovery + layered writes.
 *
 * anc memory search <query>                             — search all agents' + shared memory
 * anc memory read @<role> <f>                           — read another agent's memory file
 * anc memory list [@<role>]                             — list memory files for a role (or all)
 * anc memory write strategic <filename>                 — write to strategic layer
 * anc memory write domain <filename>                    — write to domain layer (default)
 * anc memory write project <project-slug> <filename>    — write to project layer
 * anc memory write <filename>                           — write to domain layer (shorthand)
 * anc memory consolidate [--role <role>] [--dry-run]    — run consolidation engine
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

/**
 * Write a memory file to a specific layer.
 *
 * Accepts args in these forms:
 *   write strategic company-mission.md        → strategic layer
 *   write domain api-patterns.md              → domain layer
 *   write project marketing-q2 campaign.md    → project layer
 *   write my-notes.md                         → domain layer (default)
 */
export async function memoryWriteCommand(args: string[]): Promise<void> {
  if (args.length === 0) {
    console.error('Usage: anc memory write [strategic|domain|project <slug>] <filename>');
    process.exit(1);
  }

  const role = process.env.AGENT_ROLE;
  if (!role) {
    console.error('AGENT_ROLE env not set. Memory write must run inside an agent session.');
    process.exit(1);
  }

  const { writeMemory } = await import('../agents/memory.js');
  const { readFileSync: readFs, existsSync: existsFs } = await import('fs');
  const { join: joinPath } = await import('path');

  let layer = 'domain' as 'strategic' | 'domain' | 'project';
  let projectSlug: string | undefined;
  let filename: string;

  const validLayers = ['strategic', 'domain', 'project'];

  if (validLayers.includes(args[0])) {
    layer = args[0] as 'strategic' | 'domain' | 'project';
    if (layer === 'project') {
      if (args.length < 3) {
        console.error('Usage: anc memory write project <project-slug> <filename>');
        process.exit(1);
      }
      projectSlug = args[1];
      filename = args[2];
    } else {
      if (args.length < 2) {
        console.error(`Usage: anc memory write ${layer} <filename>`);
        process.exit(1);
      }
      filename = args[1];
    }
  } else {
    // No layer specified — default to domain
    filename = args[0];
  }

  // Ensure .md extension
  if (!filename.endsWith('.md')) {
    filename = filename + '.md';
  }

  // Read content from stdin
  const chunks: Buffer[] = [];
  process.stdin.resume();
  process.stdin.setEncoding('utf-8');

  const content = await new Promise<string>((resolve) => {
    let data = '';
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => { resolve(data); });
  });

  if (!content.trim()) {
    console.error('No content provided on stdin.');
    process.exit(1);
  }

  writeMemory(role, filename, content, layer, projectSlug);
  const layerLabel = layer === 'project' ? `project/${projectSlug}` : layer;
  console.log(`Memory written: ${layerLabel}/${filename} (${content.length} chars)`);
}

/**
 * Run the memory consolidation engine.
 * anc memory consolidate [--role <role>] [--dry-run]
 */
export async function memoryConsolidateCommand(opts: { role?: string; dryRun?: boolean }): Promise<void> {
  const { consolidateAll } = await import('../core/memory-consolidation.js');
  const { join } = await import('path');
  const { homedir } = await import('os');

  const stateDir = process.env.ANC_STATE_DIR || join(homedir(), '.anc');
  const dryRun = opts.dryRun ?? false;

  if (dryRun) {
    console.log('DRY RUN — no files will be modified.\n');
  }

  const results = consolidateAll(stateDir, { role: opts.role, dryRun });

  if (results.length === 0) {
    console.log('No agent memory directories found.');
    return;
  }

  let totalScanned = 0;
  let totalDuplicates = 0;
  let totalConflicts = 0;
  let totalStale = 0;
  let totalDecayed = 0;

  for (const r of results) {
    console.log(`@${r.role}: ${r.scanned} files scanned, ${r.duplicatesMerged} duplicates merged, ${r.contradictionsFlagged} contradictions flagged, ${r.staleMarked} stale-marked, ${r.importanceDecayed} importance-decayed`);
    totalScanned += r.scanned;
    totalDuplicates += r.duplicatesMerged;
    totalConflicts += r.contradictionsFlagged;
    totalStale += r.staleMarked;
    totalDecayed += r.importanceDecayed;
  }

  console.log(`\nTotal: ${totalScanned} files scanned, ${totalDuplicates} duplicates merged, ${totalConflicts} contradictions flagged, ${totalStale} stale-marked, ${totalDecayed} importance-decayed`);
}
