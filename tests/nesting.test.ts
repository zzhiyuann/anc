import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fs so buildSpawnScript doesn't write to disk
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    writeFileSync: vi.fn(),
    existsSync: vi.fn().mockReturnValue(false),
  };
});

import { _buildSpawnScript } from '../src/runtime/runner.js';
import { existsSync } from 'fs';

const mockedExistsSync = vi.mocked(existsSync);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Nesting Prevention (buildSpawnScript)', () => {
  it('unsets CLAUDE_CODE env var', () => {
    const script = _buildSpawnScript('/workspace/ANC-1', 'do work', 'engineer', 'ANC-1', false);
    expect(script).toContain('unset CLAUDE_CODE');
  });

  it('unsets CLAUDECODE env var', () => {
    const script = _buildSpawnScript('/workspace/ANC-1', 'do work', 'engineer', 'ANC-1', false);
    expect(script).toContain('CLAUDECODE');
    // Verify it's in the unset line, not just any reference
    const unsetLine = script.split('\n').find(l => l.startsWith('unset'));
    expect(unsetLine).toContain('CLAUDECODE');
  });

  it('unsets CLAUDE_CODE_ENTRYPOINT env var', () => {
    const script = _buildSpawnScript('/workspace/ANC-1', 'do work', 'engineer', 'ANC-1', false);
    const unsetLine = script.split('\n').find(l => l.startsWith('unset'));
    expect(unsetLine).toContain('CLAUDE_CODE_ENTRYPOINT');
  });

  it('all three nesting vars unset on same line', () => {
    const script = _buildSpawnScript('/workspace/ANC-1', 'do work', 'engineer', 'ANC-1', false);
    expect(script).toContain('unset CLAUDE_CODE CLAUDECODE CLAUDE_CODE_ENTRYPOINT');
  });
});

describe('Spawn Script Flags', () => {
  it('uses --continue flag when useContinue=true', () => {
    const script = _buildSpawnScript('/workspace/ANC-1', 'do work', 'engineer', 'ANC-1', true);
    expect(script).toContain('--continue');
  });

  it('omits --continue flag when useContinue=false', () => {
    const script = _buildSpawnScript('/workspace/ANC-1', 'do work', 'engineer', 'ANC-1', false);
    expect(script).not.toContain('--continue');
  });

  it('uses --permission-mode auto', () => {
    const script = _buildSpawnScript('/workspace/ANC-1', 'do work', 'engineer', 'ANC-1', false);
    expect(script).toContain('--permission-mode auto');
  });
});

describe('Spawn Script Environment', () => {
  it('sets AGENT_ROLE to the role', () => {
    const script = _buildSpawnScript('/workspace/ANC-1', 'do work', 'strategist', 'ANC-1', false);
    expect(script).toContain('export AGENT_ROLE="strategist"');
  });

  it('sets ANC_ISSUE_KEY to the issue key', () => {
    const script = _buildSpawnScript('/workspace/ANC-1', 'do work', 'engineer', 'ANC-42', false);
    expect(script).toContain('export ANC_ISSUE_KEY="ANC-42"');
  });

  it('sets ANC_SERVER_URL', () => {
    const script = _buildSpawnScript('/workspace/ANC-1', 'do work', 'engineer', 'ANC-1', false);
    expect(script).toContain('export ANC_SERVER_URL=');
  });

  it('cds into the workspace directory', () => {
    const script = _buildSpawnScript('/workspace/ANC-1', 'do work', 'engineer', 'ANC-1', false);
    expect(script).toContain('cd "/workspace/ANC-1"');
  });

  it('loads OAuth token when it exists', () => {
    mockedExistsSync.mockReturnValue(true);
    const script = _buildSpawnScript('/workspace/ANC-1', 'do work', 'engineer', 'ANC-1', false);
    expect(script).toContain('export ANC_AGENT_TOKEN=');
  });

  it('comments about missing token when no OAuth token', () => {
    mockedExistsSync.mockReturnValue(false);
    const script = _buildSpawnScript('/workspace/ANC-1', 'do work', 'engineer', 'ANC-1', false);
    expect(script).toContain('# No agent OAuth token');
  });
});
