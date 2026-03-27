/**
 * Discord ↔ Linear conversation bridge.
 *
 * Flow 1: New Discord message → create Linear issue + optional @agent dispatch
 * Flow 2: Quote-reply to linked message → add comment on Linear issue
 * Flow 3: Agent comment on linked issue → reply in Discord thread
 * Flow 4: Agent completion on linked issue → reply in Discord thread
 */

import { bus } from '../bus.js';
import { loadRoutingConfig, buildMentionRegex } from '../routing/rules.js';
import { resolveSession } from '../runtime/resolve.js';
import { createIssue, addComment } from '../linear/client.js';
import { replyInDiscord } from '../channels/discord.js';
import { createLink, getLinkByDiscordId, getRootLink, getLatestLink } from '../bridge/mappings.js';
import { getRegisteredAgents } from '../agents/registry.js';
import { createLogger } from '../core/logger.js';

const log = createLogger('bridge');

/** Extract a title from Discord message content (first sentence or first 120 chars) */
function extractTitle(content: string): string {
  // Strip @mentions for the title
  const cleaned = content.replace(/@\w+/g, '').trim();
  // First line or first sentence
  const firstLine = cleaned.split('\n')[0];
  const firstSentence = firstLine.split(/[.!?]/)[0];
  const raw = firstSentence.length > 5 ? firstSentence : firstLine;
  return raw.length > 120 ? raw.substring(0, 117) + '...' : raw;
}

export function registerBridgeHandlers(): void {
  const config = loadRoutingConfig();
  if (!config.discord_bridge?.enabled) {
    log.debug('Bridge disabled');
    return;
  }

  const bridgeConfig = config.discord_bridge;

  // ─── Flow 1 + 2: Discord message → Linear issue or comment ───
  bus.on('discord:message', async ({ content, channelId, messageId, isReply, referencedMessageId }) => {
    // Skip short messages
    if (content.trim().length < bridgeConfig.min_length) return;

    // ── Flow 2: Quote-reply → Linear comment ──
    if (isReply && referencedMessageId) {
      const parentLink = getLinkByDiscordId(referencedMessageId);
      if (parentLink?.linearIssueKey) {
        const commentBody = `[Discord] ${content}`;
        const commentId = await addComment(parentLink.linearIssueKey, commentBody);
        if (commentId) {
          createLink(messageId, channelId, parentLink.linearIssueKey, 'comment', commentId);
          log.info(`Reply → comment on ${parentLink.linearIssueKey}`, { issueKey: parentLink.linearIssueKey });
        }
        return;
      }
      // Referenced message not in mapping — fall through to Flow 1
    }

    // ── Flow 1: New message → create Linear issue ──
    const title = extractTitle(content);
    const description = `**Source:** Discord\n\n${content}`;
    const labelNames = bridgeConfig.label ? [bridgeConfig.label] : undefined;

    const issue = await createIssue(title, description, labelNames);
    if (!issue) {
      log.error('Failed to create issue from Discord message');
      return;
    }

    createLink(messageId, channelId, issue.identifier, 'root');
    log.info(`Created ${issue.identifier} from Discord`, { issueKey: issue.identifier });

    // React with issue link
    await replyInDiscord(messageId, channelId, `Created **${issue.identifier}**: ${title}`);

    // If @agent mentioned, dispatch immediately
    const mentionRegex = buildMentionRegex(config);
    const match = content.match(mentionRegex);
    if (match) {
      const role = match[1].toLowerCase();
      const prompt = content.replace(mentionRegex, '').trim();
      const result = resolveSession({
        role,
        issueKey: issue.identifier,
        prompt: `[Discord] ${prompt}`,
        priority: 2,
      });
      const status = result.action === 'queued' ? `${role} is busy — queued.` : `${role}: ${result.action}.`;
      await replyInDiscord(messageId, channelId, status);
    }
  });

  // ─── Flow 3: Agent comment on Linear → reply in Discord ───
  bus.on('webhook:comment.created', async ({ comment, issue }) => {
    // Only bridge agent-authored comments back to Discord
    const agents = getRegisteredAgents();
    const isAgent = agents.some(a => a.linearUserId === comment.userId);
    if (!isAgent) return;

    const link = getLatestLink(issue.identifier);
    if (!link) return;  // No Discord origin

    const agentRole = agents.find(a => a.linearUserId === comment.userId)?.role ?? 'agent';
    const body = `**[${agentRole}]** ${comment.body}`;

    const reply = await replyInDiscord(link.discordMessageId, link.discordChannelId, body);
    if (reply) {
      createLink(reply.id, link.discordChannelId, issue.identifier, 'agent_reply', comment.id);
      log.info(`Agent reply bridged to Discord for ${issue.identifier}`, { issueKey: issue.identifier });
    }
  });

  // ─── Flow 4: Agent completion → reply in Discord thread ───
  bus.on('agent:completed', async ({ role, issueKey, handoff }) => {
    const rootLink = getRootLink(issueKey);
    if (!rootLink) return;  // Not a Discord-originated issue

    const summary = handoff.length > 300 ? handoff.substring(0, 300) + '...' : handoff;
    const body = `**[${role}]** Completed **${issueKey}**\n${summary}`;

    const reply = await replyInDiscord(rootLink.discordMessageId, rootLink.discordChannelId, body);
    if (reply) {
      createLink(reply.id, rootLink.discordChannelId, issueKey, 'agent_reply');
      log.info(`Completion bridged to Discord for ${issueKey}`, { issueKey });
    }
  });

  log.info('Bridge handlers registered');
}
