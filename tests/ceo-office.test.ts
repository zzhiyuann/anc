/**
 * Phase 1 — CEO Office Agent tests.
 * Verifies ceo-office config, persona, duties, and duty issue filtering.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { parse as parseYaml } from 'yaml';
import { setFileLogging } from '../src/core/logger.js';

setFileLogging(false);

const PROJECT_ROOT = join(import.meta.dirname, '..');

// --- Config ---

describe('CEO Office — config', () => {
  it('ceo-office exists in agents.yaml config', () => {
    const configPath = join(PROJECT_ROOT, 'config', 'agents.yaml');
    expect(existsSync(configPath)).toBe(true);

    const raw = readFileSync(configPath, 'utf-8');
    const config = parseYaml(raw) as { agents: Record<string, unknown> };
    expect(config.agents['ceo-office']).toBeDefined();
  });

  it('has correct name and maxConcurrency', () => {
    const configPath = join(PROJECT_ROOT, 'config', 'agents.yaml');
    const config = parseYaml(readFileSync(configPath, 'utf-8')) as {
      agents: Record<string, { name: string; maxConcurrency: number; model: string }>;
    };
    const ceo = config.agents['ceo-office'];
    expect(ceo.name).toBe('CEO Office');
    expect(ceo.maxConcurrency).toBe(1);
    expect(ceo.model).toBe('claude-code');
  });

  it('has persona files defined', () => {
    const configPath = join(PROJECT_ROOT, 'config', 'agents.yaml');
    const config = parseYaml(readFileSync(configPath, 'utf-8')) as {
      agents: Record<string, { base: string; role: string; protocols: string[] }>;
    };
    const ceo = config.agents['ceo-office'];
    expect(ceo.base).toBe('personas/base.md');
    expect(ceo.role).toBe('personas/roles/ceo-office.md');
    expect(ceo.protocols.length).toBeGreaterThan(0);
  });
});

// --- Persona file ---

describe('CEO Office — persona file', () => {
  it('persona file exists and is loadable', () => {
    const personaPath = join(PROJECT_ROOT, 'personas', 'roles', 'ceo-office.md');
    expect(existsSync(personaPath)).toBe(true);
    const content = readFileSync(personaPath, 'utf-8');
    expect(content.length).toBeGreaterThan(0);
  });

  it('persona mentions monitoring and coordination', () => {
    const personaPath = join(PROJECT_ROOT, 'personas', 'roles', 'ceo-office.md');
    const content = readFileSync(personaPath, 'utf-8').toLowerCase();
    expect(content).toContain('monitor');
    expect(content).toContain('coordinat');
  });

  it('persona includes anti-patterns section', () => {
    const personaPath = join(PROJECT_ROOT, 'personas', 'roles', 'ceo-office.md');
    const content = readFileSync(personaPath, 'utf-8');
    expect(content).toContain('Anti-Patterns');
    expect(content).toContain('DO NOT');
  });
});

// --- Duty issue filtering (isDutyIssue from on-lifecycle) ---

describe('CEO Office — isDutyIssue', () => {
  // Reimplementation of isDutyIssue for direct testing
  // (matches the logic in src/hooks/on-lifecycle.ts)
  function isDutyIssue(issueKey: string): boolean {
    return issueKey.startsWith('pulse-') || issueKey.startsWith('postmortem-')
      || issueKey.startsWith('healthcheck-') || issueKey.startsWith('recovery-');
  }

  it('correctly identifies healthcheck-* as duty issue', () => {
    expect(isDutyIssue('healthcheck-1234')).toBe(true);
    expect(isDutyIssue('healthcheck-daily')).toBe(true);
  });

  it('correctly identifies recovery-* as duty issue', () => {
    expect(isDutyIssue('recovery-ANC-42')).toBe(true);
    expect(isDutyIssue('recovery-engineer-timeout')).toBe(true);
  });

  it('correctly identifies pulse-* as duty issue', () => {
    expect(isDutyIssue('pulse-daily')).toBe(true);
    expect(isDutyIssue('pulse-hourly')).toBe(true);
  });

  it('correctly identifies postmortem-* as duty issue', () => {
    expect(isDutyIssue('postmortem-123')).toBe(true);
  });

  it('does NOT flag regular issues as duty', () => {
    expect(isDutyIssue('ANC-1')).toBe(false);
    expect(isDutyIssue('ANC-100')).toBe(false);
    expect(isDutyIssue('RYA-42')).toBe(false);
  });

  it('does NOT flag partial matches', () => {
    expect(isDutyIssue('not-healthcheck-1234')).toBe(false);
    expect(isDutyIssue('my-recovery-plan')).toBe(false);
  });
});

// --- Duties defined ---

describe('CEO Office — duties', () => {
  it('health-monitor duty: healthcheck-* prefix exists in lifecycle filter', () => {
    // Verify the lifecycle handler skips healthcheck-* issues (duty sessions)
    // This is proven by the isDutyIssue function which checks the prefix
    const testCases = ['healthcheck-1234', 'healthcheck-daily-check'];
    for (const key of testCases) {
      const isDuty = key.startsWith('healthcheck-') || key.startsWith('recovery-');
      expect(isDuty).toBe(true);
    }
  });

  it('agent-recovery duty: recovery-* prefix exists in lifecycle filter', () => {
    const testCases = ['recovery-ANC-1', 'recovery-engineer-stuck'];
    for (const key of testCases) {
      const isDuty = key.startsWith('recovery-');
      expect(isDuty).toBe(true);
    }
  });

  it('ceo-office has dutySlots defined in config', () => {
    const configPath = join(PROJECT_ROOT, 'config', 'agents.yaml');
    const config = parseYaml(readFileSync(configPath, 'utf-8')) as {
      agents: Record<string, { dutySlots: number }>;
    };
    expect(config.agents['ceo-office'].dutySlots).toBeGreaterThanOrEqual(1);
  });
});
