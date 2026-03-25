/**
 * Discord message handler — routes @agent mentions via resolveSession.
 */

import { bus } from '../bus.js';
import { loadRoutingConfig, buildMentionRegex } from '../routing/rules.js';
import { resolveSession } from '../runtime/runner.js';
import { replyInDiscord } from '../channels/discord.js';
import chalk from 'chalk';

export function registerDiscordHandlers(): void {
  bus.on('discord:message', async ({ content, channelId, messageId }) => {
    const config = loadRoutingConfig();
    const regex = buildMentionRegex(config);
    const match = content.match(regex);
    if (!match) return;

    const role = match[1].toLowerCase();
    const issueMatch = content.match(/([A-Z]+-\d+)/);
    const issueKey = issueMatch ? issueMatch[1] : 'discord-adhoc';
    const prompt = content.replace(regex, '').trim();

    console.log(chalk.cyan(`[discord] @${role}: ${content.substring(0, 80)}`));

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
