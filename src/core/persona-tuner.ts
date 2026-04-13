// TODO parent: wire into src/api/routes.ts
//
// Real persona scope analysis. Reads personas/roles/<role>.md, extracts the
// "Scope" / "owns" / "responsible for" sections, tokenises them, and emits:
//   - overlap suggestions when two roles share too many scope tokens
//   - gap suggestions when no role mentions a critical capability
//   - health suggestions when a role has no retrospectives file
//
// Returns at most 10 suggestions, sorted by severity (overlap > gap > health).

import { promises as fs } from "node:fs";
import path from "node:path";
import { listPersonas, readPersona } from "./personas.js";

export type SuggestionKind = "overlap" | "gap" | "health";

export interface Suggestion {
  id: string;
  kind: SuggestionKind;
  severity: number; // higher = more severe
  title: string;
  rationale: string;
  affectedRoles: string[];
}

const STOPWORDS = new Set([
  "a","an","and","are","as","at","be","by","for","from","has","have","in","is",
  "it","its","of","on","or","that","the","this","to","was","were","with","you",
  "your","yours","i","we","our","ours","they","them","their","but","not","no",
  "do","does","did","will","would","should","can","could","may","might","must",
  "if","then","else","when","where","while","than","so","such","all","any",
  "each","every","most","more","less","other","into","onto","over","under",
  "out","up","down","very","just","also","like","than","because","via","per",
  "etc","eg","ie","one","two","three","new","old","good","bad","make","makes",
  "made","get","gets","got","use","uses","used","work","works","working",
  "thing","things","stuff","own","owns","owned","lots","few","some","many",
]);

const CRITICAL_CAPABILITIES = [
  "deploy", "rollback", "incident", "review", "retrospective", "plan",
];

const SCOPE_HEADER_RE = /^##+\s*(scope|owns?|responsibilit(?:y|ies)|responsible for)\s*$/i;
const HEADER_RE = /^##+\s+/;

/**
 * Extract the "Scope" / "Owns" / "Responsible for" sections from a persona
 * markdown file. Returns the concatenated section bodies as one lowercase
 * string. Falls back to the entire body if no scope section is found.
 */
function extractScopeSection(md: string): string {
  const lines = md.split(/\r?\n/);
  const collected: string[] = [];
  let inside = false;
  for (const line of lines) {
    if (HEADER_RE.test(line)) {
      inside = SCOPE_HEADER_RE.test(line.trim());
      continue;
    }
    if (inside) collected.push(line);
  }
  if (collected.length === 0) return md.toLowerCase();
  return collected.join("\n").toLowerCase();
}

function tokenise(text: string): Set<string> {
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 4 && !STOPWORDS.has(t));
  return new Set(tokens);
}

function intersect<T>(a: Set<T>, b: Set<T>): T[] {
  const out: T[] = [];
  for (const x of a) if (b.has(x)) out.push(x);
  return out;
}

const OVERLAP_THRESHOLD = 5;

export async function analyzeScopes(): Promise<Suggestion[]> {
  const roles = await listPersonas();
  if (roles.length === 0) return [];

  const scopes = new Map<string, Set<string>>();
  const fullText = new Map<string, string>();
  for (const role of roles) {
    try {
      const body = await readPersona(role);
      fullText.set(role, body.toLowerCase());
      scopes.set(role, tokenise(extractScopeSection(body)));
    } catch {
      // Unreadable persona — skip silently
    }
  }

  const suggestions: Suggestion[] = [];

  // 1. Pairwise overlap detection
  const roleList = Array.from(scopes.keys());
  for (let i = 0; i < roleList.length; i++) {
    for (let j = i + 1; j < roleList.length; j++) {
      const a = roleList[i];
      const b = roleList[j];
      const shared = intersect(scopes.get(a)!, scopes.get(b)!);
      if (shared.length >= OVERLAP_THRESHOLD) {
        const sample = shared.slice(0, 5).join(", ");
        suggestions.push({
          id: `overlap-${a}-${b}`,
          kind: "overlap",
          severity: 100 + shared.length,
          title: `${a} and ${b} have ${shared.length} overlapping scope terms`,
          rationale: `Both personas mention: ${sample}. Overlap creates routing ambiguity for the CEO dispatcher — consider concentrating ownership in one role.`,
          affectedRoles: [a, b],
        });
      }
    }
  }

  // 2. Critical capability gaps
  for (const cap of CRITICAL_CAPABILITIES) {
    const owners: string[] = [];
    for (const [role, body] of fullText.entries()) {
      if (body.includes(cap)) owners.push(role);
    }
    if (owners.length === 0) {
      suggestions.push({
        id: `gap-${cap}`,
        kind: "gap",
        severity: 50,
        title: `No role mentions "${cap}"`,
        rationale: `None of the personas in personas/roles/ describe responsibility for "${cap}". This is a capability gap — assign it to an existing role or create a new one.`,
        affectedRoles: [],
      });
    }
  }

  // 3. Health: roles with no retrospectives file
  const rolesDir = path.resolve(process.cwd(), "personas", "roles");
  for (const role of roleList) {
    const retroPath = path.join(rolesDir, `${role}-retro.md`);
    let exists = false;
    try {
      await fs.access(retroPath);
      exists = true;
    } catch {
      exists = false;
    }
    if (!exists) {
      suggestions.push({
        id: `health-retro-${role}`,
        kind: "health",
        severity: 10,
        title: `${role} has no retrospectives file`,
        rationale: `Expected personas/roles/${role}-retro.md to capture lessons learned. Without retros, the role cannot improve over time.`,
        affectedRoles: [role],
      });
    }
  }

  // Sort by severity descending and cap at 10
  suggestions.sort((a, b) => b.severity - a.severity);
  return suggestions.slice(0, 10);
}
