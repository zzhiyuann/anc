/**
 * Model pricing constants and cost computation.
 *
 * Per-token USD prices for Anthropic Claude models, expressed as USD per
 * million tokens. Numbers are best-known public list prices as of late 2025
 * and used to compute approximate session cost from token usage reported
 * inside Claude Code's transcript JSONL.
 *
 * Source: https://www.anthropic.com/pricing
 *
 * If exact pricing for a model is unknown we fall back to Sonnet rates,
 * which is conservative-ish for current use.
 */

export interface ModelPricing {
  inputPerMtok: number;
  outputPerMtok: number;
  cacheReadPerMtok: number;
  cacheWritePerMtok: number;
}

export const MODEL_PRICING: Record<string, ModelPricing> = {
  // Claude Opus 4.x family
  'claude-opus-4-6': { inputPerMtok: 15.0, outputPerMtok: 75.0, cacheReadPerMtok: 1.5, cacheWritePerMtok: 18.75 },
  'claude-opus-4-5': { inputPerMtok: 15.0, outputPerMtok: 75.0, cacheReadPerMtok: 1.5, cacheWritePerMtok: 18.75 },
  'claude-opus-4':   { inputPerMtok: 15.0, outputPerMtok: 75.0, cacheReadPerMtok: 1.5, cacheWritePerMtok: 18.75 },
  // Claude Sonnet 4.x family
  'claude-sonnet-4-6': { inputPerMtok: 3.0, outputPerMtok: 15.0, cacheReadPerMtok: 0.3, cacheWritePerMtok: 3.75 },
  'claude-sonnet-4-5': { inputPerMtok: 3.0, outputPerMtok: 15.0, cacheReadPerMtok: 0.3, cacheWritePerMtok: 3.75 },
  'claude-sonnet-4':   { inputPerMtok: 3.0, outputPerMtok: 15.0, cacheReadPerMtok: 0.3, cacheWritePerMtok: 3.75 },
  // Claude Haiku 4.x family
  'claude-haiku-4-5': { inputPerMtok: 1.0, outputPerMtok: 5.0, cacheReadPerMtok: 0.1, cacheWritePerMtok: 1.25 },
  'claude-haiku-4':   { inputPerMtok: 1.0, outputPerMtok: 5.0, cacheReadPerMtok: 0.1, cacheWritePerMtok: 1.25 },
};

const FALLBACK: ModelPricing = MODEL_PRICING['claude-sonnet-4-5'];

export interface TokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/**
 * Best-effort lookup. Matches by exact key first, then by prefix substring
 * (e.g. real model id 'claude-opus-4-6-20251022' → MODEL_PRICING key 'claude-opus-4-6').
 * Returns Sonnet pricing if nothing matches.
 */
export function getPricing(model: string | undefined | null): ModelPricing {
  if (!model) return FALLBACK;
  if (MODEL_PRICING[model]) return MODEL_PRICING[model];
  // Find longest matching prefix key
  let best: { key: string; len: number } | null = null;
  for (const key of Object.keys(MODEL_PRICING)) {
    if (model.startsWith(key) && (!best || key.length > best.len)) {
      best = { key, len: key.length };
    }
  }
  return best ? MODEL_PRICING[best.key] : FALLBACK;
}

/** Compute USD cost from token usage for a given model. */
export function computeCost(model: string | undefined | null, usage: TokenUsage): number {
  const p = getPricing(model);
  const cost =
    (usage.input * p.inputPerMtok) / 1_000_000 +
    (usage.output * p.outputPerMtok) / 1_000_000 +
    (usage.cacheRead * p.cacheReadPerMtok) / 1_000_000 +
    (usage.cacheWrite * p.cacheWritePerMtok) / 1_000_000;
  return cost;
}

/** Total tokens (sum of all categories) — used for the budget_log.tokens column. */
export function totalTokens(usage: TokenUsage): number {
  return usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
}
