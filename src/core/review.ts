/**
 * Review-strictness policy.
 *
 * Decides whether an agent HANDOFF auto-advances a task to `done` or stops
 * at `review`. Configured by `config/review.yaml` and resolved with this
 * precedence: task override > project > role > default.
 *
 * Levels:
 *   strict       — always require human review; notify
 *   normal       — require review; notify; (parent will add a 24h auto-done duty later)
 *   lax          — auto-done; notify
 *   autonomous   — auto-done; silent
 *   peer-review  — bounce to a peer agent of the same role; silent
 */

import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import YAML from 'yaml';
import type { Task, TaskState } from './tasks.js';

export type ReviewLevel =
  | 'strict'
  | 'normal'
  | 'lax'
  | 'autonomous'
  | 'peer-review';

const VALID_LEVELS: ReadonlySet<string> = new Set([
  'strict',
  'normal',
  'lax',
  'autonomous',
  'peer-review',
]);

export interface ReviewConfig {
  default: ReviewLevel;
  roles: Record<string, ReviewLevel>;
  projects: Record<string, ReviewLevel>;
  /** Per-task overrides, keyed by taskId. */
  overrides: Record<string, ReviewLevel>;
}

export interface ReviewConfigPatch {
  default?: ReviewLevel;
  roles?: Record<string, ReviewLevel | null>;
  projects?: Record<string, ReviewLevel | null>;
  overrides?: Record<string, ReviewLevel | null>;
}

export const HARDCODED_DEFAULT: ReviewConfig = {
  default: 'normal',
  roles: {
    engineer: 'normal',
    strategist: 'normal',
    ops: 'lax',
    'ceo-office': 'autonomous',
  },
  projects: {},
  overrides: {},
};

const CONFIG_PATH = resolve(process.cwd(), 'config', 'review.yaml');

let cached: ReviewConfig | null = null;

function isLevel(x: unknown): x is ReviewLevel {
  return typeof x === 'string' && VALID_LEVELS.has(x);
}

/** Coerce a parsed YAML object into a strict ReviewConfig, dropping invalid entries. */
export function normalizeConfig(raw: unknown): ReviewConfig {
  const out: ReviewConfig = {
    default: HARDCODED_DEFAULT.default,
    roles: {},
    projects: {},
    overrides: {},
  };
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as Record<string, unknown>;
  if (isLevel(r.default)) out.default = r.default;

  const sections: Array<['roles' | 'projects' | 'overrides']> = [
    ['roles'],
    ['projects'],
    ['overrides'],
  ];
  for (const [key] of sections) {
    const val = r[key];
    if (val && typeof val === 'object') {
      for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
        if (isLevel(v)) out[key][k] = v;
      }
    }
  }
  return out;
}

export function loadReviewConfig(): ReviewConfig {
  if (cached) return cached;
  if (!existsSync(CONFIG_PATH)) {
    cached = { ...HARDCODED_DEFAULT, roles: { ...HARDCODED_DEFAULT.roles } };
    return cached;
  }
  try {
    const raw = readFileSync(CONFIG_PATH, 'utf8');
    cached = normalizeConfig(YAML.parse(raw));
  } catch {
    cached = { ...HARDCODED_DEFAULT, roles: { ...HARDCODED_DEFAULT.roles } };
  }
  return cached;
}

/** Force the next loadReviewConfig() call to re-read from disk. */
export function invalidateReviewCache(): void {
  cached = null;
}

/** Deep-merge a patch into a config. `null` values delete the key. */
export function mergeReviewConfig(
  base: ReviewConfig,
  patch: ReviewConfigPatch,
): ReviewConfig {
  const next: ReviewConfig = {
    default: base.default,
    roles: { ...base.roles },
    projects: { ...base.projects },
    overrides: { ...base.overrides },
  };
  if (patch.default !== undefined) {
    if (!isLevel(patch.default)) {
      throw new Error(`invalid default review level: ${patch.default}`);
    }
    next.default = patch.default;
  }
  for (const section of ['roles', 'projects', 'overrides'] as const) {
    const sectionPatch = patch[section];
    if (!sectionPatch) continue;
    for (const [k, v] of Object.entries(sectionPatch)) {
      if (v === null) {
        delete next[section][k];
      } else if (isLevel(v)) {
        next[section][k] = v;
      } else {
        throw new Error(`invalid review level for ${section}.${k}: ${String(v)}`);
      }
    }
  }
  return next;
}

export function saveReviewConfig(patch: ReviewConfigPatch): ReviewConfig {
  const merged = mergeReviewConfig(loadReviewConfig(), patch);
  writeReviewConfig(merged);
  return merged;
}

/** Overwrite the on-disk config with a complete value. Invalidates cache. */
export function writeReviewConfig(config: ReviewConfig): void {
  mkdirSync(dirname(CONFIG_PATH), { recursive: true });
  writeFileSync(CONFIG_PATH, YAML.stringify(config), 'utf8');
  invalidateReviewCache();
}

/** Reset to the hardcoded default and persist. */
export function resetReviewConfig(): ReviewConfig {
  const fresh: ReviewConfig = {
    default: HARDCODED_DEFAULT.default,
    roles: { ...HARDCODED_DEFAULT.roles },
    projects: {},
    overrides: {},
  };
  writeReviewConfig(fresh);
  return fresh;
}

/**
 * Resolve the effective review level for a (task, role, project) tuple.
 * Precedence: task override > project > role > default.
 */
export function resolveReviewLevel(
  taskId: string | null | undefined,
  role: string | null | undefined,
  projectId: string | null | undefined,
  config: ReviewConfig = loadReviewConfig(),
): ReviewLevel {
  if (taskId && config.overrides[taskId]) return config.overrides[taskId];
  if (projectId && config.projects[projectId]) return config.projects[projectId];
  if (role && config.roles[role]) return config.roles[role];
  return config.default;
}

export interface HandoffPolicyDecision {
  nextState: TaskState;
  notify: boolean;
  spawnPeer?: string;
}

export interface HandoffPolicyInput {
  /** Role that posted the handoff. Used for peer-review peer selection. */
  role?: string | null;
  /**
   * Optional resolver for picking a peer of the same role when level is
   * `peer-review`. Returning null leaves spawnPeer undefined.
   */
  pickPeer?: (role: string) => string | null;
}

/**
 * Apply the configured review policy to a freshly-parsed handoff. Pure: no
 * side effects, no DB writes — caller is responsible for state transitions.
 *
 * Decision table:
 *   strict      → review,  notify=true
 *   normal      → review,  notify=true   (parent will add 24h timeout duty)
 *   lax         → done,    notify=true
 *   autonomous  → done,    notify=false
 *   peer-review → review,  notify=false, spawnPeer=<peer of same role>
 */
export function applyHandoffPolicy(
  task: Pick<Task, 'id' | 'projectId'>,
  handoff: HandoffPolicyInput,
): HandoffPolicyDecision {
  const role = handoff.role ?? null;
  const level = resolveReviewLevel(task.id, role, task.projectId);
  switch (level) {
    case 'strict':
      return { nextState: 'review', notify: true };
    case 'normal':
      // NOTE: parent will add a 24h-timeout duty that auto-advances `review`
      // → `done` if no human acts. Out of scope for this wave.
      return { nextState: 'review', notify: true };
    case 'lax':
      return { nextState: 'done', notify: true };
    case 'autonomous':
      return { nextState: 'done', notify: false };
    case 'peer-review': {
      const peer = role && handoff.pickPeer ? handoff.pickPeer(role) : null;
      return {
        nextState: 'review',
        notify: false,
        ...(peer ? { spawnPeer: peer } : {}),
      };
    }
  }
}
