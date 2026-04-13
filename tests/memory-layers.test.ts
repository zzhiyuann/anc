/**
 * Layered memory architecture tests.
 * Tests strategic/domain/project layer loading, token budgets,
 * frontmatter parsing, backward compatibility, and injection order.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setFileLogging } from '../src/core/logger.js';

setFileLogging(false);

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
    statSync: vi.fn(() => ({ isDirectory: () => true, mtimeMs: Date.now(), size: 100 })),
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
      personaFiles: [],
      maxConcurrency: 5,
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

import { buildPersona } from '../src/agents/persona.js';
import { parseFrontmatter } from '../src/agents/persona.js';
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

// --- Frontmatter parsing ---

describe('parseFrontmatter — extended fields', () => {
  it('parses layer field', () => {
    const raw = '---\nimportance: high\nlayer: strategic\n---\nContent here';
    const result = parseFrontmatter(raw);
    expect(result.importance).toBe('high');
    expect(result.layer).toBe('strategic');
    expect(result.content).toBe('Content here');
  });

  it('parses project field', () => {
    const raw = '---\nlayer: project\nproject: marketing-q2\n---\nCampaign notes';
    const result = parseFrontmatter(raw);
    expect(result.layer).toBe('project');
    expect(result.project).toBe('marketing-q2');
  });

  it('parses tags field', () => {
    const raw = '---\ntags: [architecture, decisions, testing]\n---\nContent';
    const result = parseFrontmatter(raw);
    expect(result.tags).toEqual(['architecture', 'decisions', 'testing']);
  });

  it('parses updated field', () => {
    const raw = '---\nupdated: 2026-04-13\n---\nContent';
    const result = parseFrontmatter(raw);
    expect(result.updated).toBe('2026-04-13');
  });

  it('returns defaults for raw content without frontmatter', () => {
    const result = parseFrontmatter('Just plain content');
    expect(result.importance).toBe('normal');
    expect(result.layer).toBeUndefined();
    expect(result.content).toBe('Just plain content');
  });
});

// --- Layer 1: Strategic ---

describe('Layered memory — strategic', () => {
  it('always loads strategic memory files', () => {
    const memDir = '/mock/.anc/agents/engineer/memory';
    const stratDir = `${memDir}/strategic`;
    mockDirs[memDir] = [];
    mockDirs[stratDir] = ['company-mission.md', 'arch-decisions.md'];
    mockFiles[`${stratDir}/company-mission.md`] = 'We build AI-native companies.';
    mockFiles[`${stratDir}/arch-decisions.md`] = 'Event-driven architecture.';

    const persona = buildPersona('engineer');
    expect(persona).toContain('Strategic Knowledge (always loaded)');
    expect(persona).toContain('AI-native companies');
    expect(persona).toContain('Event-driven architecture');
  });

  it('caps strategic files at 5', () => {
    const memDir = '/mock/.anc/agents/engineer/memory';
    const stratDir = `${memDir}/strategic`;
    mockDirs[memDir] = [];
    const files: string[] = [];
    for (let i = 0; i < 8; i++) {
      const name = `strat-${i}.md`;
      files.push(name);
      mockFiles[`${stratDir}/${name}`] = `Strategic content ${i}`;
    }
    mockDirs[stratDir] = files;

    const persona = buildPersona('engineer');
    const sections = (persona.match(/### strat-/g) || []).length;
    expect(sections).toBeLessThanOrEqual(5);
  });
});

// --- Layer 2: Domain ---

describe('Layered memory — domain', () => {
  it('loads domain files sorted by importance', () => {
    const memDir = '/mock/.anc/agents/engineer/memory';
    const domainDir = `${memDir}/domain`;
    mockDirs[memDir] = [];
    mockDirs[domainDir] = ['low-pri.md', 'high-pri.md'];
    mockFiles[`${domainDir}/high-pri.md`] = '---\nimportance: high\n---\nHIGH domain content';
    mockFiles[`${domainDir}/low-pri.md`] = '---\nimportance: low\n---\nLOW domain content';

    const persona = buildPersona('engineer');
    expect(persona).toContain('Domain Expertise');
    const highIdx = persona.indexOf('HIGH domain content');
    const lowIdx = persona.indexOf('LOW domain content');
    expect(highIdx).toBeLessThan(lowIdx);
  });
});

// --- Layer 3: Project ---

describe('Layered memory — project', () => {
  it('loads project memory only when projectSlug matches', () => {
    const memDir = '/mock/.anc/agents/engineer/memory';
    const projDir = `${memDir}/project/marketing-q2`;
    mockDirs[memDir] = [];
    mockDirs[`${memDir}/project/marketing-q2`] = ['campaign.md'];
    mockFiles[`${projDir}/campaign.md`] = 'Q2 campaign details.';

    // Without projectSlug — should NOT load
    const personaNoProject = buildPersona('engineer');
    expect(personaNoProject).not.toContain('Q2 campaign details');

    // With matching projectSlug — should load
    const personaWithProject = buildPersona('engineer', 'marketing-q2');
    expect(personaWithProject).toContain('Project Context: marketing-q2');
    expect(personaWithProject).toContain('Q2 campaign details');
  });

  it('does not load mismatched project memory', () => {
    const memDir = '/mock/.anc/agents/engineer/memory';
    const projDir = `${memDir}/project/infra`;
    mockDirs[memDir] = [];
    mockDirs[`${memDir}/project/infra`] = ['deploy.md'];
    mockFiles[`${projDir}/deploy.md`] = 'Deploy runbook.';

    const persona = buildPersona('engineer', 'marketing-q2');
    expect(persona).not.toContain('Deploy runbook');
  });
});

// --- Layer 4: Retrospectives ---

describe('Layered memory — retrospectives', () => {
  it('loads last 3 retrospectives', () => {
    const retroDir = '/mock/.anc/agents/engineer/retrospectives';
    mockDirs[retroDir] = ['2026-04-01.md', '2026-04-02.md', '2026-04-03.md', '2026-04-04.md', '2026-04-05.md'];
    mockFiles[`${retroDir}/2026-04-01.md`] = 'Retro 1';
    mockFiles[`${retroDir}/2026-04-02.md`] = 'Retro 2';
    mockFiles[`${retroDir}/2026-04-03.md`] = 'Retro 3';
    mockFiles[`${retroDir}/2026-04-04.md`] = 'Retro 4';
    mockFiles[`${retroDir}/2026-04-05.md`] = 'Retro 5';

    const persona = buildPersona('engineer');
    expect(persona).toContain('Recent Retrospectives');
    expect(persona).toContain('Retro 5');
    expect(persona).toContain('Retro 4');
    expect(persona).toContain('Retro 3');
    expect(persona).not.toContain('Retro 1');
    expect(persona).not.toContain('Retro 2');
  });
});

// --- Layer 5: Shared ---

describe('Layered memory — shared', () => {
  it('loads shared memory with importance sorting', () => {
    const sharedDir = `${home}/.anc/memory/shared`;
    mockDirs[sharedDir] = ['company-values.md', 'minor-note.md'];
    mockFiles[`${sharedDir}/company-values.md`] = '---\nimportance: high\n---\nShip fast.';
    mockFiles[`${sharedDir}/minor-note.md`] = '---\nimportance: low\n---\nMinor shared note.';

    const persona = buildPersona('engineer');
    expect(persona).toContain('Shared Company Knowledge');
    const highIdx = persona.indexOf('Ship fast');
    const lowIdx = persona.indexOf('Minor shared note');
    expect(highIdx).toBeLessThan(lowIdx);
  });
});

// --- Backward compatibility ---

describe('Layered memory — backward compatibility', () => {
  it('treats flat memory files as domain layer', () => {
    const memDir = '/mock/.anc/agents/engineer/memory';
    mockDirs[memDir] = ['old-note.md', 'conventions.md'];
    mockFiles[`${memDir}/old-note.md`] = 'Legacy flat file content.';
    mockFiles[`${memDir}/conventions.md`] = 'Code conventions.';

    const persona = buildPersona('engineer');
    expect(persona).toContain('Domain Expertise');
    expect(persona).toContain('Legacy flat file content');
    expect(persona).toContain('Code conventions');
  });

  it('flat files with strategic frontmatter go to strategic layer', () => {
    const memDir = '/mock/.anc/agents/engineer/memory';
    mockDirs[memDir] = ['mission.md', 'normal-note.md'];
    mockFiles[`${memDir}/mission.md`] = '---\nimportance: critical\nlayer: strategic\n---\nOur mission is X.';
    mockFiles[`${memDir}/normal-note.md`] = 'Just a normal note.';

    const persona = buildPersona('engineer');
    expect(persona).toContain('Strategic Knowledge');
    expect(persona).toContain('Our mission is X');
    expect(persona).toContain('Domain Expertise');
    expect(persona).toContain('normal note');
  });

  it('handles missing memory directory gracefully', () => {
    const persona = buildPersona('engineer');
    expect(persona).toContain('Engineer');
    expect(persona).toContain('ANC SDK Reference');
  });
});

// --- Injection order ---

describe('Layered memory — injection order', () => {
  it('injects strategic before domain before project', () => {
    const memDir = '/mock/.anc/agents/engineer/memory';
    const stratDir = `${memDir}/strategic`;
    const domainDir = `${memDir}/domain`;
    const projDir = `${memDir}/project/my-proj`;
    const retroDir = '/mock/.anc/agents/engineer/retrospectives';

    mockDirs[memDir] = [];
    mockDirs[stratDir] = ['strat.md'];
    mockDirs[domainDir] = ['dom.md'];
    mockDirs[`${memDir}/project/my-proj`] = ['proj.md'];
    mockDirs[retroDir] = ['2026-04-13.md'];

    mockFiles[`${stratDir}/strat.md`] = 'STRATEGIC_MARKER';
    mockFiles[`${domainDir}/dom.md`] = 'DOMAIN_MARKER';
    mockFiles[`${projDir}/proj.md`] = 'PROJECT_MARKER';
    mockFiles[`${retroDir}/2026-04-13.md`] = 'RETRO_MARKER';

    const persona = buildPersona('engineer', 'my-proj');

    const stratIdx = persona.indexOf('STRATEGIC_MARKER');
    const domIdx = persona.indexOf('DOMAIN_MARKER');
    const projIdx = persona.indexOf('PROJECT_MARKER');
    const retroIdx = persona.indexOf('RETRO_MARKER');

    expect(stratIdx).toBeGreaterThan(-1);
    expect(domIdx).toBeGreaterThan(-1);
    expect(projIdx).toBeGreaterThan(-1);
    expect(retroIdx).toBeGreaterThan(-1);

    expect(stratIdx).toBeLessThan(domIdx);
    expect(domIdx).toBeLessThan(projIdx);
    expect(projIdx).toBeLessThan(retroIdx);
  });
});

// --- SDK reference includes memory write ---

describe('Persona — SDK reference', () => {
  it('includes anc memory write in SDK reference', () => {
    const persona = buildPersona('engineer');
    expect(persona).toContain('anc memory write');
  });
});
