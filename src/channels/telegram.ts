/**
 * Telegram channel — outbound notifications to CEO only.
 * Uses direct Bot API (no polling, no OpenClaw dependency).
 */

import chalk from 'chalk';

const BOT_TOKEN = process.env.ANC_TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.ANC_TELEGRAM_CHAT_ID;

// Dedup
const recentMessages = new Map<string, number>();
const DEDUP_WINDOW_MS = 60_000;

/** Send a notification to the CEO via Telegram */
export async function sendTelegram(message: string): Promise<boolean> {
  if (!BOT_TOKEN || !CHAT_ID) return false;

  // Dedup
  const fingerprint = message.substring(0, 200);
  const now = Date.now();
  if (recentMessages.has(fingerprint) && now - recentMessages.get(fingerprint)! < DEDUP_WINDOW_MS) {
    return false;
  }
  recentMessages.set(fingerprint, now);
  if (recentMessages.size > 50) {
    for (const [k, ts] of recentMessages) {
      if (now - ts > DEDUP_WINDOW_MS) recentMessages.delete(k);
    }
  }

  // Truncate for Telegram limit
  const truncated = message.length > 4000 ? message.substring(0, 4000) + '...' : message;

  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: CHAT_ID, text: truncated }),
    });
    const data = await res.json() as { ok: boolean };
    return data.ok;
  } catch (err) {
    console.error(chalk.red(`[telegram] Send failed: ${(err as Error).message}`));
    return false;
  }
}
