// TODO parent: wire into src/api/routes.ts
//
// Stub for scope overlap / gap analysis. Today this returns a static set of
// suggestions so the UI can render a representative `Scope health` callout.
// A future pass will run a CEO-Office worker that actually diffs the
// personas/roles/*.md files and produces real overlap / gap suggestions.

import { listPersonas } from "./personas.js";

export type SuggestionKind = "overlap" | "gap" | "rename";

export interface Suggestion {
  id: string;
  kind: SuggestionKind;
  title: string;
  rationale: string;
  affectedRoles: string[];
}

export async function analyzeScopes(): Promise<Suggestion[]> {
  const roles = await listPersonas();
  const has = (r: string) => roles.includes(r);

  const out: Suggestion[] = [];

  if (has("engineer") && has("strategist")) {
    out.push({
      id: "overlap-product-decisions",
      kind: "overlap",
      title:
        "Engineer and Strategist both claim 'product decisions' — recommend move to Strategist",
      rationale:
        "Both personas describe owning product scope. Concentrating product decisions in Strategist removes ambiguity for the CEO router.",
      affectedRoles: ["engineer", "strategist"],
    });
  }

  if (!has("designer")) {
    out.push({
      id: "gap-design-review",
      kind: "gap",
      title: "No role owns design review",
      rationale:
        "UI work currently falls between Engineer and Strategist. A dedicated Designer role (or explicit assignment to Strategist) would close this gap.",
      affectedRoles: [],
    });
  }

  return out;
}
