/**
 * Discord message handler — routes @agent mentions via resolveSession.
 */

import { bus } from '../bus.js';
import { loadRoutingConfig, buildMentionRegex } from '../routing/rules.js';
import { resolveSession } from '../runtime/resolve.js';
import { replyInDiscord } from '../channels/discord.js';
import { createLogger } from '../core/logger.js';

const log = createLogger('discord');

export function registerDiscordHandlers(): void {
  bus.on('discord:message', async ({ content, channelId, messageId }) => {
    // If bridge is enabled, it handles all Discord messages — skip legacy handler
    const config = loadRoutingConfig();
    if (config.discord_bridge?.enabled) return;

    const regex = buildMentionRegex(config);
    const match = content.match(regex);
    if (!match) return;

    const role = match[1].toLowerCase();
    const issueMatch = content.match(/([A-Z]+-\d+)/);
    const issueKey = issueMatch ? issueMatch[1] : 'discord-adhoc';
    const prompt = content.replace(regex, '').trim();

    log.info(`@${role}: ${content.substring(0, 80)}`);

    const result = resolveSession({
      role,
      issueKey,
      prompt: `[Discord] ${prompt}`,
      priority: 2,
    });

    const msg = result.action === 'queued' ? `${role} is busy — queued.` : `${role}: ${result.action}.`;
    await replyInDiscord(messageId, channelId, msg);
  });
}
