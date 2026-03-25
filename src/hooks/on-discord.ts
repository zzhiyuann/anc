/**
 * Discord message handler — routes @agent mentions from Discord
 * through the same pipeline as Linear webhooks.
 */

import { bus } from '../bus.js';
import { loadRoutingConfig, buildMentionRegex } from '../routing/rules.js';
import { hasCapacity } from '../runtime/health.js';
import { spawnAgent } from '../runtime/runner.js';
import { enqueue } from '../routing/queue.js';
import { replyInDiscord } from '../channels/discord.js';
import chalk from 'chalk';

export function registerDiscordHandlers(): void {
  bus.on('discord:message', async ({ content, channelId, messageId }) => {
    const config = loadRoutingConfig();
    const regex = buildMentionRegex(config);
    const match = content.match(regex);

    if (!match) return;

    const role = match[1].toLowerCase();
    console.log(chalk.cyan(`[discord] Routing to ${role}: ${content.substring(0, 80)}`));

    // Extract issue key if mentioned (e.g., "RYA-232")
    const issueMatch = content.match(/([A-Z]+-\d+)/);
    const issueKey = issueMatch ? issueMatch[1] : 'discord-adhoc';

    // Remove the @mention from the prompt
    const prompt = content.replace(regex, '').trim();

    if (!hasCapacity(role)) {
      enqueue({
        issueKey,
        issueId: '',
        agentRole: role,
        priority: 2,
        context: `[Discord] ${prompt}`,
      });
      await replyInDiscord(messageId, channelId, `${role} is busy — queued.`);
    } else {
      spawnAgent({ role, issueKey, prompt: `[Discord request] ${prompt}` });
      await replyInDiscord(messageId, channelId, `${role} is on it.`);
    }
  });
}
