/**
 * Token bucket rate limiter for Linear API.
 * Linear's limit: ~50 requests/minute for API key auth.
 * Queues excess requests and drains them with exponential backoff.
 */

import { createLogger } from '../core/logger.js';

const log = createLogger('rate-limit');

const MAX_TOKENS = 50;
const REFILL_INTERVAL_MS = 60_000; // 1 minute
const BASE_DELAY_MS = 1000;        // initial backoff delay
const MAX_DELAY_MS = 30_000;       // cap backoff at 30s

let tokens = MAX_TOKENS;
let lastRefill = Date.now();

function refill(): void {
  const now = Date.now();
  const elapsed = now - lastRefill;
  if (elapsed >= REFILL_INTERVAL_MS) {
    tokens = MAX_TOKENS;
    lastRefill = now;
  } else {
    // Partial refill proportional to elapsed time
    const added = Math.floor((elapsed / REFILL_INTERVAL_MS) * MAX_TOKENS);
    tokens = Math.min(MAX_TOKENS, tokens + added);
    if (added > 0) lastRefill = now;
  }
}

function tryConsume(): boolean {
  refill();
  if (tokens > 0) {
    tokens--;
    return true;
  }
  return false;
}

function backoffDelay(attempt: number): number {
  return Math.min(BASE_DELAY_MS * 2 ** attempt, MAX_DELAY_MS);
}

function is429(err: unknown): boolean {
  if (err instanceof Error) {
    if (err.message.includes('429') || err.message.includes('rate limit')) return true;
    if ('status' in err && (err as { status: number }).status === 429) return true;
  }
  return false;
}

/**
 * Execute a function with rate limiting and exponential backoff.
 * Handles both client-side token bucket exhaustion and server-side 429 responses.
 */
export async function withRateLimit<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // Wait for a token from the bucket
    if (!tryConsume()) {
      const delay = backoffDelay(attempt);
      log.debug(`Rate limit: bucket empty, backing off ${delay}ms (attempt ${attempt + 1}/${maxRetries + 1})`);
      await sleep(delay);
      refill();
      if (!tryConsume()) continue;
    }

    try {
      return await fn();
    } catch (err) {
      if (is429(err) && attempt < maxRetries) {
        // Server returned 429 — drain the bucket and back off
        tokens = 0;
        const delay = backoffDelay(attempt);
        log.warn(`Rate limit: 429 from Linear API, backing off ${delay}ms (attempt ${attempt + 1}/${maxRetries + 1})`);
        await sleep(delay);
        refill();
        continue;
      }
      throw err;
    }
  }
  // Last resort: run anyway (better to risk a 429 than to drop the request)
  log.warn('Rate limit: exhausted retries, proceeding anyway');
  return fn();
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Get current bucket state (for monitoring/testing) */
export function getRateLimitStatus(): { tokens: number; max: number } {
  refill();
  return { tokens, max: MAX_TOKENS };
}

/** Reset bucket (for testing) */
export function _resetRateLimit(): void {
  tokens = MAX_TOKENS;
  lastRefill = Date.now();
}
