import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Set ANC_STATE_DIR before importing memory module so it uses our temp dir
const testDir = join(tmpdir(), `anc-mem-test-${Date.now()}`);
process.env.ANC_STATE_DIR = testDir;

// Import after setting env
import {
  searchMemory,
  getMemoryIndex,
  readMemoryFile,
  listMemoryFiles,
  readSharedMemoryFile,
} from '../src/core/memory.js';

function setup() {
  // Create agent memory directories with test files
  const engineerDir = join(testDir, 'agents', 'engineer', 'memory');
  const strategistDir = join(testDir, 'agents', 'strategist', 'memory');
  const sharedDir = join(testDir, 'shared-memory');

  mkdirSync(engineerDir, { recursive: true });
  mkdirSync(strategistDir, { recursive: true });
  mkdirSync(sharedDir, { recursive: true });

  writeFileSync(join(engineerDir, 'architecture.md'), '# Architecture\nMicroservices with API gateway.\nRate limiting at the edge.');
  writeFileSync(join(engineerDir, 'patterns.md'), '# Patterns\nUse repository pattern for data access.');
  writeFileSync(join(strategistDir, 'pricing-analysis.md'), '# Pricing\nFree tier: 50 users. Pro tier: $29/mo.');
  writeFileSync(join(strategistDir, 'market-research.md'), '# Market\nCompetitor pricing tier starts at $19.');
  writeFileSync(join(sharedDir, 'company-glossary.md'), '# Glossary\nANC = Agent Native Company.\nPricing model: per-seat.');
}

function cleanup() {
  if (existsSync(testDir)) {
    rmSync(testDir, { recursive: true, force: true });
  }
}

describe('Cross-agent memory search', () => {
  beforeEach(() => {
    cleanup();
    setup();
  });

  afterEach(() => {
    cleanup();
  });

  it('finds matches in filenames', () => {
    const results = searchMemory('pricing');
    expect(results.length).toBeGreaterThan(0);
    const pricingFile = results.find(r => r.filename === 'pricing-analysis.md');
    expect(pricingFile).toBeDefined();
    expect(pricingFile!.role).toBe('strategist');
    // Should match both filename and content
    expect(pricingFile!.matchType).toBe('both');
  });

  it('finds matches in content only', () => {
    const results = searchMemory('rate limit');
    expect(results.length).toBeGreaterThan(0);
    const archResult = results.find(r => r.filename === 'architecture.md');
    expect(archResult).toBeDefined();
    expect(archResult!.matchType).toBe('content');
    expect(archResult!.snippet).toContain('Rate limiting');
  });

  it('searches shared memory', () => {
    const results = searchMemory('glossary');
    expect(results.length).toBeGreaterThan(0);
    const shared = results.find(r => r.role === 'shared');
    expect(shared).toBeDefined();
    expect(shared!.filename).toBe('company-glossary.md');
  });

  it('ranks filename matches above content-only matches', () => {
    const results = searchMemory('pricing');
    // pricing-analysis.md should appear before market-research.md
    const pricingIdx = results.findIndex(r => r.filename === 'pricing-analysis.md');
    const marketIdx = results.findIndex(r => r.filename === 'market-research.md');
    expect(pricingIdx).toBeLessThan(marketIdx);
  });

  it('returns empty for no match', () => {
    const results = searchMemory('xyznonexistent');
    expect(results).toEqual([]);
  });

  it('is case-insensitive', () => {
    const results = searchMemory('PRICING');
    expect(results.length).toBeGreaterThan(0);
  });

  it('respects limit', () => {
    const results = searchMemory('pricing', 1);
    expect(results.length).toBe(1);
  });

  it('returns empty for empty query', () => {
    expect(searchMemory('')).toEqual([]);
  });
});

describe('Memory index', () => {
  beforeEach(() => {
    cleanup();
    setup();
  });

  afterEach(() => {
    cleanup();
  });

  it('returns all agents and shared', () => {
    const index = getMemoryIndex();
    expect(index.agents.engineer).toBeDefined();
    expect(index.agents.engineer.files).toContain('architecture.md');
    expect(index.agents.engineer.files).toContain('patterns.md');
    expect(index.agents.strategist).toBeDefined();
    expect(index.agents.strategist.files).toContain('pricing-analysis.md');
    expect(index.shared).toBeDefined();
    expect(index.shared.files).toContain('company-glossary.md');
  });

  it('calculates total sizes', () => {
    const index = getMemoryIndex();
    expect(index.agents.engineer.totalSize).toBeGreaterThan(0);
    expect(index.shared.totalSize).toBeGreaterThan(0);
  });
});

describe('Read shared memory file', () => {
  beforeEach(() => {
    cleanup();
    setup();
  });

  afterEach(() => {
    cleanup();
  });

  it('reads an existing shared file', () => {
    const result = readSharedMemoryFile('company-glossary.md');
    expect(result).not.toBeNull();
    expect(result!.body).toContain('Agent Native Company');
  });

  it('returns null for nonexistent file', () => {
    expect(readSharedMemoryFile('nope.md')).toBeNull();
  });

  it('rejects path traversal', () => {
    expect(readSharedMemoryFile('../etc/passwd')).toBeNull();
    expect(readSharedMemoryFile('../../secrets.md')).toBeNull();
  });

  it('rejects invalid filenames', () => {
    expect(readSharedMemoryFile('hello world.md')).toBeNull();
    expect(readSharedMemoryFile('')).toBeNull();
  });
});

describe('Cross-agent read (readMemoryFile)', () => {
  beforeEach(() => {
    cleanup();
    setup();
  });

  afterEach(() => {
    cleanup();
  });

  it('reads another agent memory file', async () => {
    const result = await readMemoryFile('strategist', 'pricing-analysis.md');
    expect(result).not.toBeNull();
    expect(result!.body).toContain('Free tier');
  });

  it('returns null for missing file', async () => {
    const result = await readMemoryFile('engineer', 'nonexistent.md');
    expect(result).toBeNull();
  });
});
