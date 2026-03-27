/**
 * Discord channel — bidirectional.
 * INPUT:  Bot listens for messages → routes via event bus
 * OUTPUT: Webhook posts with per-agent identity (avatar + display name)
 */

import { Client, GatewayIntentBits, type Message } from 'discord.js';
import { bus } from '../bus.js';
import { loadRoutingConfig, buildMentionRegex } from '../routing/rules.js';
import { createLogger } from '../core/logger.js';

const log = createLogger('discord');

let client: Client | null = null;
let channelId: string | null = null;
let webhookUrl: string | null = null;

// --- Per-agent identity (webhook-based) ---

const DISPLAY_NAMES: Record<string, string> = {
  engineer: 'Engineer',
  strategist: 'Strategist',
  ops: 'Ops',
  system: 'ANC',
};

const AVATARS: Record<string, string> = {
  engineer: 'https://api.dicebear.com/9.x/bottts-neutral/png?seed=anc-engineer&backgroundColor=3b82f6&size=128',
  strategist: 'https://api.dicebear.com/9.x/bottts-neutral/png?seed=anc-strategist&backgroundColor=8b5cf6&size=128',
  ops: 'https://api.dicebear.com/9.x/bottts-neutral/png?seed=anc-ops&backgroundColor=f59e0b&size=128',
  system: 'https://api.dicebear.com/9.x/bottts-neutral/png?seed=anc-system&backgroundColor=64748b&size=128',
};

// --- Dedup (prevent double-posting) ---
const recentMessages = new Map<string, number>();
const DEDUP_WINDOW_MS = 30_000;

function isDuplicate(content: string): boolean {
  const now = Date.now();
  // Cleanup old entries
  if (recentMessages.size > 50) {
    for (const [key, ts] of recentMessages) {
      if (now - ts > DEDUP_WINDOW_MS) recentMessages.delete(key);
    }
  }
  const fingerprint = content.substring(0, 200);
  if (recentMessages.has(fingerprint) && now - recentMessages.get(fingerprint)! < DEDUP_WINDOW_MS) {
    return true;
  }
  recentMessages.set(fingerprint, now);
  return false;
}

// --- Bot startup ---

export async function startDiscordBot(): Promise<boolean> {
  const token = process.env.ANC_DISCORD_BOT_TOKEN;
  channelId = process.env.ANC_DISCORD_CHANNEL_ID ?? null;
  webhookUrl = process.env.ANC_DISCORD_WEBHOOK_URL ?? null;

  if (!token) {
    log.debug('No bot token — disabled');
    return false;
  }

  client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  client.on('ready', async () => {
    log.info(`Bot connected as ${client!.user?.tag}`);

    // Auto-create webhook for per-agent identity if not configured
    if (!webhookUrl && channelId) {
      try {
        const channel = await client!.channels.fetch(channelId);
        if (channel && 'fetchWebhooks' in channel) {
          const ch = channel as { fetchWebhooks: () => Promise<Map<string, { url: string; name: string | null }>>; createWebhook: (opts: { name: string }) => Promise<{ url: string }> };
          const webhooks = await ch.fetchWebhooks();
          const existing = [...webhooks.values()].find(w => w.name === 'ANC');
          if (existing) {
            webhookUrl = existing.url;
            log.info('Using existing ANC webhook');
          } else {
            const created = await ch.createWebhook({ name: 'ANC' });
            webhookUrl = created.url;
            log.info('Created ANC webhook for per-agent identity');
          }
        }
      } catch (err) {
        log.warn(`Webhook auto-create failed (per-agent avatars disabled): ${(err as Error).message}`);
      }
    }
  });

  // Listen for messages — emit all messages to the bus (bridge + @mention handlers)
  client.on('messageCreate', async (msg: Message) => {
    if (msg.author.bot) return;
    if (channelId && msg.channelId !== channelId) return;

    const isReply = msg.reference !== null && msg.reference?.messageId !== undefined;

    log.info(`${isReply ? 'reply' : 'msg'} from ${msg.author.username}: ${msg.content.substring(0, 80)}`);
    bus.emit('discord:message', {
      content: msg.content,
      authorId: msg.author.id,
      channelId: msg.channelId,
      messageId: msg.id,
      isReply,
      referencedMessageId: msg.reference?.messageId ?? undefined,
    });
  });

  try {
    await client.login(token);
    return true;
  } catch (err) {
    log.error(`Login failed: ${(err as Error).message}`);
    return false;
  }
}

export function stopDiscordBot(): void {
  if (client) {
    client.destroy();
    client = null;
  }
}

// --- Outbound posting ---

export async function postToDiscord(role: string, message: string): Promise<Message | null> {
  const truncated = message.length > 1950 ? message.substring(0, 1950) + '...' : message;
  if (isDuplicate(truncated)) return null;

  // Prefer webhook (per-agent identity with avatar), fall back to bot
  if (webhookUrl) {
    return postViaWebhook(role, truncated);
  }

  if (!client || !channelId) return null;
  try {
    const channel = await client.channels.fetch(channelId);
    if (channel && 'send' in channel) {
      const sent = await channel.send(`**[${role}]** ${truncated}`);
      return sent;
    }
  } catch (err) {
    log.error(`Post failed: ${(err as Error).message}`);
  }
  return null;
}

/** Post via Discord webhook — each agent gets its own display name + avatar */
async function postViaWebhook(role: string, content: string): Promise<Message | null> {
  if (!webhookUrl) return null;
  const username = DISPLAY_NAMES[role] || role.charAt(0).toUpperCase() + role.slice(1);
  const avatar_url = AVATARS[role] || AVATARS.system;

  try {
    // ?wait=true makes Discord return the created Message object
    const resp = await fetch(`${webhookUrl}?wait=true`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, avatar_url, content }),
    });
    if (!resp.ok) {
      log.error(`Webhook post failed: ${resp.status}`);
      return null;
    }
    // Parse the returned message to get its ID (for reactions/replies)
    const data = await resp.json() as { id: string; channel_id: string };
    // Fetch the full Message object via bot client (needed for reactions)
    if (client && data.id) {
      try {
        const channel = await client.channels.fetch(data.channel_id);
        if (channel && 'messages' in channel) {
          return await (channel as { messages: { fetch: (id: string) => Promise<Message> } }).messages.fetch(data.id);
        }
      } catch {
        // Can't fetch message object — return null (reactions won't work, but post succeeded)
      }
    }
    return null;
  } catch (err) {
    log.error(`Webhook error: ${(err as Error).message}`);
    return null;
  }
}

/** Add emoji reactions to a Discord message */
export async function addReactions(msg: Message, emojis: string[]): Promise<void> {
  for (const emoji of emojis) {
    try {
      await msg.react(emoji);
    } catch (err) {
      log.error(`React failed (${emoji}): ${(err as Error).message}`);
    }
  }
}

/** React to a message by ID (doesn't require the Message object) */
export async function reactToMessage(messageId: string, channelIdOverride: string, emojis: string[]): Promise<void> {
  if (!client) return;
  try {
    const channel = await client.channels.fetch(channelIdOverride);
    if (channel && 'messages' in channel) {
      const msg = await (channel as { messages: { fetch: (id: string) => Promise<Message> } }).messages.fetch(messageId);
      await addReactions(msg, emojis);
    }
  } catch {
    // Best-effort — don't fail the flow for a reaction
  }
}

/** Reply to a specific Discord message. Returns the sent Message (or null). */
export async function replyInDiscord(messageId: string, channelIdOverride: string, content: string): Promise<Message | null> {
  if (!client) return null;
  try {
    const channel = await client.channels.fetch(channelIdOverride);
    if (channel && 'messages' in channel) {
      const msg = await (channel as { messages: { fetch: (id: string) => Promise<Message> } }).messages.fetch(messageId);
      return await msg.reply(content.substring(0, 1950));
    }
  } catch {
    return null;
  }
  return null;
}
