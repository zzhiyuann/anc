/**
 * Discord channel — bidirectional.
 * INPUT:  CEO @mentions agents in Discord → routes to agent via event bus
 * OUTPUT: Agent completions, group messages → posted to Discord
 */

import { Client, GatewayIntentBits, type Message } from 'discord.js';
import { bus } from '../bus.js';
import { loadRoutingConfig, buildMentionRegex } from '../routing/rules.js';
import { createLogger } from '../core/logger.js';

const log = createLogger('discord');

let client: Client | null = null;
let channelId: string | null = null;

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

  client.on('ready', () => {
    log.info(`Bot connected as ${client!.user?.tag}`);
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
  if (!client || !channelId) return null;

  const truncated = message.length > 1950 ? message.substring(0, 1950) + '...' : message;
  if (isDuplicate(truncated)) return null;

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
