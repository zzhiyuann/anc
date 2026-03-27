/**
 * Discord ↔ Linear conversation bridge.
 *
 * Flow 1: New Discord message → create Linear issue + optional @agent dispatch
 * Flow 2: Quote-reply to linked message → add comment on Linear issue
 *         (on-comment.ts handles conversation mode for Done/In Review issues)
 * Flow 3: Agent comment on linked issue → reply in Discord thread
 * Flow 4: Agent completion on linked issue → reply in Discord thread
 *
 * Emoji reactions:
 *   🔗  Issue created from message
 *   🚀  Agent dispatched
 *   💬  Comment piped / conversation mode
 *   ✅  Agent completed
 *   ❌  Error
 */

import { bus } from '../bus.js';
import { loadRoutingConfig, buildMentionRegex } from '../routing/rules.js';
import { resolveSession } from '../runtime/resolve.js';
import { createIssue, addComment, getIssue } from '../linear/client.js';
import { replyInDiscord, reactToMessage } from '../channels/discord.js';
import { createLink, getLinkByDiscordId, getRootLink, getLatestLink } from '../bridge/mappings.js';
import { getRegisteredAgents } from '../agents/registry.js';
import { getSessionForIssue } from '../runtime/health.js';
import { createLogger } from '../core/logger.js';

const log = createLogger('bridge');

const CONVERSATION_STATUSES = ['Done', 'In Review', 'Canceled'];

/** Extract a title from Discord message content (first sentence or first 120 chars) */
function extractTitle(content: string): string {
  const cleaned = content.replace(/@\w+/g, '').trim();
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
    if (content.trim().length < bridgeConfig.min_length) return;

    // ── Flow 2: Quote-reply → route to linked issue ──
    if (isReply && referencedMessageId) {
      const parentLink = getLinkByDiscordId(referencedMessageId);
      if (parentLink?.linearIssueKey) {
        const issueKey = parentLink.linearIssueKey;

        // Check if agent is already active on this issue → pipe directly
        const session = getSessionForIssue(issueKey);
        if (session?.state === 'active') {
          // Pipe to running session via resolveSession (it detects active + pipes)
          resolveSession({
            role: session.role,
            issueKey,
            prompt: `[Discord] ${content}`,
            priority: 2,
          });
          await reactToMessage(messageId, channelId, ['💬']);
          log.info(`Piped to active ${session.role} on ${issueKey}`, { issueKey });
          return;
        }

        // Check conversation mode (Done/In Review)
        const issue = await getIssue(issueKey);
        const isConversation = issue && CONVERSATION_STATUSES.includes(issue.status);

        // Create Linear comment — on-comment.ts will handle routing + conversation mode
        const commentBody = `[Discord] ${content}`;
        const commentId = await addComment(issueKey, commentBody);
        if (commentId) {
          createLink(messageId, channelId, issueKey, 'comment', commentId);
          await reactToMessage(messageId, channelId, isConversation ? ['💬'] : ['🚀']);
          log.info(`Reply → ${isConversation ? 'conversation' : 'comment'} on ${issueKey}`, { issueKey });
        } else {
          await reactToMessage(messageId, channelId, ['❌']);
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
      await reactToMessage(messageId, channelId, ['❌']);
      return;
    }

    createLink(messageId, channelId, issue.identifier, 'root');
    log.info(`Created ${issue.identifier} from Discord`, { issueKey: issue.identifier });
    await reactToMessage(messageId, channelId, ['🔗']);

    // Reply with issue link
    const linkReply = await replyInDiscord(messageId, channelId, `**${issue.identifier}**: ${title}`);
    if (linkReply) {
      createLink(linkReply.id, channelId, issue.identifier, 'agent_reply');
    }

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
      await reactToMessage(messageId, channelId, ['🚀']);
      const status = result.action === 'queued' ? `${role} is busy — queued.` : `${role}: ${result.action}.`;
      await replyInDiscord(messageId, channelId, status);
    }
  });

  // ─── Flow 3: Agent comment on Linear → reply in Discord ───
  bus.on('webhook:comment.created', async ({ comment, issue }) => {
    const agents = getRegisteredAgents();
    const isAgent = agents.some(a => a.linearUserId === comment.userId);
    if (!isAgent) return;

    const link = getLatestLink(issue.identifier);
    if (!link) return;

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
    if (!rootLink) return;

    const summary = handoff.length > 300 ? handoff.substring(0, 300) + '...' : handoff;
    const body = `**[${role}]** Completed **${issueKey}**\n${summary}`;

    const reply = await replyInDiscord(rootLink.discordMessageId, rootLink.discordChannelId, body);
    if (reply) {
      createLink(reply.id, rootLink.discordChannelId, issueKey, 'agent_reply');
      await reactToMessage(rootLink.discordMessageId, rootLink.discordChannelId, ['✅']);
      log.info(`Completion bridged to Discord for ${issueKey}`, { issueKey });
    }
  });

  log.info('Bridge handlers registered');
}
