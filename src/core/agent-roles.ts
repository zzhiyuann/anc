// TODO parent: wire into src/api/routes.ts
//
// CRUD over config/agents.yaml. Idempotent: createRole on existing slug is a
// no-op; archiveRole on missing slug is a no-op. All writes round-trip through
// the `yaml` package to preserve key order on existing entries where possible.

import { promises as fs } from "node:fs";
import path from "node:path";
import YAML from "yaml";

const AGENTS_YAML = path.resolve(process.cwd(), "config", "agents.yaml");
const ROLE_RE = /^[a-z0-9-]+$/;

export interface AgentRoleConfig {
  name: string;
  model: "claude-code";
  linearUserId: string;
  maxConcurrency: number;
  dutySlots: number;
  base: string;
  role: string;
  protocols: string[];
  createdAt?: number;
}

export interface CreateRoleInput {
  role: string;
  name: string;
  baseProtocol?: "coder" | "researcher" | "operator" | "executive";
  maxConcurrency?: number;
  dutySlots?: number;
  iconColor?: string;
}

interface AgentsFile {
  agents: Record<string, AgentRoleConfig>;
}

async function load(): Promise<AgentsFile> {
  try {
    const raw = await fs.readFile(AGENTS_YAML, "utf8");
    const parsed = YAML.parse(raw) as AgentsFile | null;
    if (!parsed || typeof parsed !== "object" || !parsed.agents) {
      return { agents: {} };
    }
    return parsed;
  } catch {
    return { agents: {} };
  }
}

async function save(file: AgentsFile): Promise<void> {
  await fs.mkdir(path.dirname(AGENTS_YAML), { recursive: true });
  await fs.writeFile(AGENTS_YAML, YAML.stringify(file), "utf8");
}

export async function listRoles(): Promise<
  Array<{ role: string; config: AgentRoleConfig }>
> {
  const file = await load();
  return Object.entries(file.agents).map(([role, config]) => ({ role, config }));
}

export async function createRole(input: CreateRoleInput): Promise<AgentRoleConfig> {
  if (!ROLE_RE.test(input.role)) {
    throw new Error(`invalid role slug: ${input.role}`);
  }
  const file = await load();
  if (file.agents[input.role]) {
    return file.agents[input.role];
  }

  const config: AgentRoleConfig = {
    name: input.name,
    model: "claude-code",
    linearUserId: "",
    maxConcurrency: clamp(input.maxConcurrency ?? 3, 1, 5),
    dutySlots: clamp(input.dutySlots ?? 0, 0, 3),
    base: "personas/base.md",
    role: `personas/roles/${input.role}.md`,
    protocols: [
      "personas/protocols/completion.md",
      "personas/protocols/communication.md",
      "personas/protocols/memory.md",
    ],
    createdAt: Date.now(),
  };

  file.agents[input.role] = config;
  await save(file);
  return config;
}

export interface UpdateRoleInput {
  maxConcurrency?: number;
  dutySlots?: number;
  name?: string;
  modelTier?: string;
}

export async function updateRole(role: string, patch: UpdateRoleInput): Promise<AgentRoleConfig> {
  if (!ROLE_RE.test(role)) throw new Error(`invalid role slug: ${role}`);
  const file = await load();
  if (!file.agents[role]) throw new Error(`role not found: ${role}`);

  const existing = file.agents[role];
  if (patch.maxConcurrency !== undefined) existing.maxConcurrency = clamp(patch.maxConcurrency, 1, 10);
  if (patch.dutySlots !== undefined) existing.dutySlots = clamp(patch.dutySlots, 0, 5);
  if (patch.name !== undefined) existing.name = patch.name;
  // modelTier: stored if provided (future use)
  if (patch.modelTier !== undefined) (existing as unknown as Record<string, unknown>).modelTier = patch.modelTier;

  file.agents[role] = existing;
  await save(file);
  return existing;
}

export async function archiveRole(role: string): Promise<boolean> {
  if (!ROLE_RE.test(role)) return false;
  const file = await load();
  if (!file.agents[role]) return false;
  delete file.agents[role];
  await save(file);
  return true;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
