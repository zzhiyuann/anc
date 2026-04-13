/**
 * Runner unit tests — spawn script generation and session operations.
 */
import { describe, it, expect } from 'vitest';
import { _buildSpawnScript } from '../src/runtime/runner.js';

describe('_buildSpawnScript', () => {
  it('uses interactive mode (no -p flag) for fresh spawn', () => {
    const script = _buildSpawnScript('/tmp/ws', 'Do the thing', 'engineer', 'ANC-1', false);
    // Must NOT contain -p flag — that would cause non-interactive print mode
    expect(script).not.toMatch(/claude\s.*-p\s/);
    // Must contain the interactive invocation with --dangerously-skip-permissions
    expect(script).toMatch(/claude --dangerously-skip-permissions "\$PROMPT"/);
  });

  it('uses interactive mode with --continue for resumed spawn', () => {
    const script = _buildSpawnScript('/tmp/ws', 'Continue work', 'engineer', 'ANC-2', true);
    expect(script).not.toMatch(/claude\s.*-p\s/);
    expect(script).toMatch(/claude --dangerously-skip-permissions --continue "\$PROMPT"/);
  });

  it('sets AGENT_ROLE and ANC_ISSUE_KEY env vars', () => {
    const script = _buildSpawnScript('/tmp/ws', 'test', 'strategist', 'ANC-5', false);
    expect(script).toContain('export AGENT_ROLE="strategist"');
    expect(script).toContain('export ANC_ISSUE_KEY="ANC-5"');
  });

  it('reads prompt from file to avoid shell escaping issues', () => {
    const script = _buildSpawnScript('/tmp/ws', 'prompt with $pecial "chars"', 'ops', 'ANC-3', false);
    expect(script).toContain('PROMPT=$(cat ');
    // Prompt itself should NOT be inlined in the script
    expect(script).not.toContain('$pecial');
  });

  it('unsets claude nesting env vars', () => {
    const script = _buildSpawnScript('/tmp/ws', 'test', 'engineer', 'ANC-1', false);
    expect(script).toContain('unset CLAUDE_CODE CLAUDECODE CLAUDE_CODE_ENTRYPOINT');
  });
});
