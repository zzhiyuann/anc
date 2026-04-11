/**
 * Phase 1 — Enhanced Persona integration tests.
 * Tests memory loading, shared memory, retrospectives, frontmatter parsing,
 * importance sorting, worker persona, and edge cases.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { setFileLogging } from '../src/core/logger.js';

setFileLogging(false);

// We need to mock the filesystem, registry, and config for persona tests
// because buildPersona reads files from disk and depends on agent registry.

const mockFiles: Record<string, string> = {};
const mockDirs: Record<string, string[]> = {};

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: vi.fn((path: string) => {
      if (mockFiles[path] !== undefined) return true;
      if (mockDirs[path] !== undefined) return true;
      return false;
    }),
    readFileSync: vi.fn((path: string) => {
      if (mockFiles[path] !== undefined) return mockFiles[path];
      throw new Error(`ENOENT: ${path}`);
    }),
    readdirSync: vi.fn((path: string) => {
      if (mockDirs[path] !== undefined) return mockDirs[path];
      throw new Error(`ENOENT: ${path}`);
    }),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
  };
});

vi.mock('../src/agents/registry.js', () => ({
  getAgent: vi.fn((role: string) => {
    if (role === 'engineer') return {
      name: 'Engineer',
      role: 'engineer',
      model: 'claude-code',
      linearUserId: 'uid-1',
      personaFiles: ['personas/base.md', 'personas/roles/engineer.md'],
      maxConcurrency: 5,
      dutySlots: 1,
    };
    if (role === 'missing-persona') return {
      name: 'MissingPersona',
      role: 'missing-persona',
      model: 'claude-code',
      linearUserId: '',
      personaFiles: [],
      maxConcurrency: 1,
      dutySlots: 1,
    };
    return undefined;
  }),
  getRegisteredAgents: vi.fn(() => []),
  _resetRegistry: vi.fn(),
}));

vi.mock('../src/linear/types.js', () => ({
  getConfig: vi.fn(() => ({
    stateDir: '/mock/.anc',
    linearTeamId: 'test',
    linearTeamKey: 'TEST',
    workspaceBase: '/mock/workspaces',
    webhookPort: 3849,
  })),
}));

import { buildPersona, buildWorkerPersona } from '../src/agents/persona.js';
import { homedir } from 'os';

const home = homedir();

function resetMocks() {
  for (const key of Object.keys(mockFiles)) delete mockFiles[key];
  for (const key of Object.keys(mockDirs)) delete mockDirs[key];
}

beforeEach(() => {
  resetMocks();
  vi.clearAllMocks();
});

// --- Memory loading ---

describe('Persona — memory loading', () => {
  it('loads agent memory files from the correct directory', () => {
    const memDir = '/mock/.anc/agents/engineer/memory';
    mockDirs[memDir] = ['project-context.md', 'conventions.md'];
    mockFiles[`${memDir}/project-context.md`] = 'Project uses React.';
    mockFiles[`${memDir}/conventions.md`] = 'Always use strict mode.';

    const persona = buildPersona('engineer');
    expect(persona).toContain('Project uses React');
    expect(persona).toContain('strict mode');
  });

  it('loads shared memory from ~/.anc/memory/shared/', () => {
    // Agent memory dir
    const memDir = '/mock/.anc/agents/engineer/memory';
    mockDirs[memDir] = [];

    // Shared memory dir
    const sharedDir = `${home}/.anc/memory/shared`;
    mockDirs[sharedDir] = ['company-values.md'];
    mockFiles[`${sharedDir}/company-values.md`] = 'Ship fast, iterate.';

    const persona = buildPersona('engineer');
    expect(persona).toContain('Ship fast');
    expect(persona).toContain('shared/company-values');
  });

  it('handles missing memory directory gracefully', () => {
    // No memory dir exists — buildPersona should not throw
    const persona = buildPersona('engineer');
    expect(persona).toContain('Engineer');
    expect(persona).toContain('ANC SDK Reference');
  });

  it('handles empty memory files', () => {
    const memDir = '/mock/.anc/agents/engineer/memory';
    mockDirs[memDir] = ['empty.md'];
    mockFiles[`${memDir}/empty.md`] = '   ';  // whitespace only

    // Should not throw, and empty files should be skipped
    const persona = buildPersona('engineer');
    expect(persona).not.toContain('empty');
  });
});

// --- Frontmatter parsing ---

describe('Persona — frontmatter parsing', () => {
  it('parses frontmatter with importance: high', () => {
    const memDir = '/mock/.anc/agents/engineer/memory';
    mockDirs[memDir] = ['critical-rule.md', 'minor-note.md'];
    mockFiles[`${memDir}/critical-rule.md`] = '---\nimportance: high\n---\nNever push to main.';
    mockFiles[`${memDir}/minor-note.md`] = 'Some minor note.';

    const persona = buildPersona('engineer');
    // High importance should come first (before normal)
    const highIdx = persona.indexOf('Never push to main');
    const normalIdx = persona.indexOf('Some minor note');
    expect(highIdx).toBeLessThan(normalIdx);
  });

  it('sorts memories by importance (critical > high > normal > low)', () => {
    const memDir = '/mock/.anc/agents/engineer/memory';
    mockDirs[memDir] = ['low.md', 'critical.md', 'normal.md', 'high.md'];
    mockFiles[`${memDir}/critical.md`] = '---\nimportance: critical\n---\nCRITICAL CONTENT';
    mockFiles[`${memDir}/high.md`] = '---\nimportance: high\n---\nHIGH CONTENT';
    mockFiles[`${memDir}/normal.md`] = 'NORMAL CONTENT';
    mockFiles[`${memDir}/low.md`] = '---\nimportance: low\n---\nLOW CONTENT';

    const persona = buildPersona('engineer');
    const critIdx = persona.indexOf('CRITICAL CONTENT');
    const highIdx = persona.indexOf('HIGH CONTENT');
    const normalIdx = persona.indexOf('NORMAL CONTENT');
    const lowIdx = persona.indexOf('LOW CONTENT');

    expect(critIdx).toBeGreaterThan(-1);
    expect(highIdx).toBeGreaterThan(-1);
    expect(normalIdx).toBeGreaterThan(-1);
    expect(lowIdx).toBeGreaterThan(-1);
    expect(critIdx).toBeLessThan(highIdx);
    expect(highIdx).toBeLessThan(normalIdx);
    expect(normalIdx).toBeLessThan(lowIdx);
  });

  it('tags non-normal importance in section header', () => {
    const memDir = '/mock/.anc/agents/engineer/memory';
    mockDirs[memDir] = ['important.md'];
    mockFiles[`${memDir}/important.md`] = '---\nimportance: high\n---\nImportant content.';

    const persona = buildPersona('engineer');
    expect(persona).toContain('[high]');
  });
});

// --- Retrospectives ---

describe('Persona — retrospectives', () => {
  it('loads last 3 retrospectives sorted by recency', () => {
    const retroDir = '/mock/.anc/agents/engineer/retrospectives';
    mockDirs[retroDir] = ['2026-04-01.md', '2026-04-02.md', '2026-04-03.md', '2026-04-04.md', '2026-04-05.md'];
    mockFiles[`${retroDir}/2026-04-01.md`] = 'Retro 1';
    mockFiles[`${retroDir}/2026-04-02.md`] = 'Retro 2';
    mockFiles[`${retroDir}/2026-04-03.md`] = 'Retro 3';
    mockFiles[`${retroDir}/2026-04-04.md`] = 'Retro 4';
    mockFiles[`${retroDir}/2026-04-05.md`] = 'Retro 5';

    // Also need memory dir to avoid errors
    const memDir = '/mock/.anc/agents/engineer/memory';
    mockDirs[memDir] = [];

    const persona = buildPersona('engineer');
    // Should include retros 5, 4, 3 (most recent 3)
    expect(persona).toContain('Retro 5');
    expect(persona).toContain('Retro 4');
    expect(persona).toContain('Retro 3');
    // Should NOT include retros 1, 2
    expect(persona).not.toContain('Retro 1');
    expect(persona).not.toContain('Retro 2');
  });

  it('handles missing retrospectives directory', () => {
    const memDir = '/mock/.anc/agents/engineer/memory';
    mockDirs[memDir] = [];

    const persona = buildPersona('engineer');
    expect(persona).not.toContain('Retrospective');
  });
});

// --- Memory cap ---

describe('Persona — memory cap', () => {
  it('caps at 20 memory files', () => {
    const memDir = '/mock/.anc/agents/engineer/memory';
    const files: string[] = [];
    for (let i = 0; i < 25; i++) {
      const name = `mem-${String(i).padStart(2, '0')}.md`;
      files.push(name);
      mockFiles[`${memDir}/${name}`] = `Memory content ${i}`;
    }
    mockDirs[memDir] = files;

    const persona = buildPersona('engineer');
    // Count the number of "### mem-" sections — should be capped at 20
    const memSections = (persona.match(/### mem-/g) || []).length;
    expect(memSections).toBeLessThanOrEqual(20);
  });
});

// --- Worker Persona ---

describe('Persona — buildWorkerPersona', () => {
  it('returns lightweight prompt without memory', () => {
    const worker = buildWorkerPersona('ANC-42', 'Fix login bug', 'Login page crashes on click.');
    expect(worker).toContain('Worker Agent');
    expect(worker).toContain('ANC-42');
    expect(worker).toContain('Fix login bug');
    expect(worker).toContain('Login page crashes');
    expect(worker).not.toContain('Accumulated Knowledge');
    expect(worker).not.toContain('Retrospective');
  });

  it('includes issue key and title', () => {
    const worker = buildWorkerPersona('ANC-100', 'Deploy to staging');
    expect(worker).toContain('ANC-100');
    expect(worker).toContain('Deploy to staging');
  });

  it('handles missing description gracefully', () => {
    const worker = buildWorkerPersona('ANC-50', 'Quick task');
    expect(worker).toContain('See the issue description');
  });

  it('includes HANDOFF.md instruction', () => {
    const worker = buildWorkerPersona('ANC-1', 'Task');
    expect(worker).toContain('HANDOFF.md');
  });

  it('includes anc CLI reference', () => {
    const worker = buildWorkerPersona('ANC-1', 'Task');
    expect(worker).toContain('anc comment');
    expect(worker).toContain('anc status');
  });
});

// --- Throws for unknown agent ---

describe('Persona — error handling', () => {
  it('throws for unknown agent role', () => {
    expect(() => buildPersona('nonexistent')).toThrow('Unknown agent role');
  });
});
