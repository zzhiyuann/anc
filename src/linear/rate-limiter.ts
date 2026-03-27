/**
 * Token bucket rate limiter for Linear API.
 * Linear's limit: ~50 requests/minute for API key auth.
 * Queues excess requests and drains them with backoff.
 */

import { createLogger } from '../core/logger.js';

const log = createLogger('rate-limit');

const MAX_TOKENS = 50;
const REFILL_INTERVAL_MS = 60_000; // 1 minute
const RETRY_DELAY_MS = 1200;       // wait ~1.2s per retry

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

/**
 * Execute a function with rate limiting.
 * If the bucket is empty, waits and retries up to maxRetries times.
 */
export async function withRateLimit<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (tryConsume()) {
      return fn();
    }
    log.debug(`Rate limit: waiting ${RETRY_DELAY_MS}ms (attempt ${attempt + 1}/${maxRetries + 1})`);
    await sleep(RETRY_DELAY_MS);
    refill();
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
