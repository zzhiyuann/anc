// TODO parent: wire into src/api/routes.ts
//
// Persona file CRUD. All operations are constrained to personas/roles/<role>.md
// inside the repo root. Path-traversal safe: role names are validated against
// /^[a-z0-9-]+$/ and never concatenated as raw filesystem paths.

import { promises as fs } from "node:fs";
import path from "node:path";

const ROLES_DIR = path.resolve(process.cwd(), "personas", "roles");
const ROLE_RE = /^[a-z0-9-]+$/;

function rolePath(role: string): string {
  if (!ROLE_RE.test(role)) {
    throw new Error(`invalid role slug: ${role}`);
  }
  const file = path.join(ROLES_DIR, `${role}.md`);
  // Defence-in-depth: ensure resolved path is still inside ROLES_DIR.
  const resolved = path.resolve(file);
  if (!resolved.startsWith(ROLES_DIR + path.sep)) {
    throw new Error(`path escape detected for role: ${role}`);
  }
  return resolved;
}

export async function readPersona(role: string): Promise<string> {
  const p = rolePath(role);
  return fs.readFile(p, "utf8");
}

export async function writePersona(role: string, body: string): Promise<void> {
  const p = rolePath(role);
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, body, "utf8");
}

export async function listPersonas(): Promise<string[]> {
  try {
    const entries = await fs.readdir(ROLES_DIR);
    return entries
      .filter((f) => f.endsWith(".md"))
      .map((f) => f.slice(0, -3))
      .filter((slug) => ROLE_RE.test(slug))
      .sort();
  } catch {
    return [];
  }
}
