/**
 * Discord ↔ Linear mapping persistence.
 * Tracks which Discord messages correspond to which Linear issues/comments.
 */

import { getDb } from '../core/db.js';

export interface DiscordLink {
  discordMessageId: string;
  discordChannelId: string;
  linearIssueKey?: string;
  linearCommentId?: string;
  linkType: 'root' | 'comment' | 'agent_reply';
  createdAt: string;
}

export function createLink(
  discordMessageId: string,
  discordChannelId: string,
  linearIssueKey: string,
  linkType: DiscordLink['linkType'],
  linearCommentId?: string,
): void {
  getDb().prepare(`
    INSERT OR REPLACE INTO discord_links
    (discord_message_id, discord_channel_id, linear_issue_key, linear_comment_id, link_type)
    VALUES (?, ?, ?, ?, ?)
  `).run(discordMessageId, discordChannelId, linearIssueKey, linearCommentId ?? null, linkType);
}

export function getLinkByDiscordId(discordMessageId: string): DiscordLink | null {
  const row = getDb().prepare('SELECT * FROM discord_links WHERE discord_message_id = ?').get(discordMessageId) as Record<string, unknown> | undefined;
  return row ? mapRow(row) : null;
}

export function getLinksByIssueKey(issueKey: string): DiscordLink[] {
  const rows = getDb().prepare('SELECT * FROM discord_links WHERE linear_issue_key = ? ORDER BY created_at ASC').all(issueKey) as Array<Record<string, unknown>>;
  return rows.map(mapRow);
}

export function getRootLink(issueKey: string): DiscordLink | null {
  const row = getDb().prepare("SELECT * FROM discord_links WHERE linear_issue_key = ? AND link_type = 'root' LIMIT 1").get(issueKey) as Record<string, unknown> | undefined;
  return row ? mapRow(row) : null;
}

export function getLatestLink(issueKey: string): DiscordLink | null {
  const row = getDb().prepare('SELECT * FROM discord_links WHERE linear_issue_key = ? ORDER BY created_at DESC LIMIT 1').get(issueKey) as Record<string, unknown> | undefined;
  return row ? mapRow(row) : null;
}

function mapRow(r: Record<string, unknown>): DiscordLink {
  return {
    discordMessageId: r.discord_message_id as string,
    discordChannelId: r.discord_channel_id as string,
    linearIssueKey: r.linear_issue_key as string | undefined,
    linearCommentId: r.linear_comment_id as string | undefined,
    linkType: r.link_type as DiscordLink['linkType'],
    createdAt: r.created_at as string,
  };
}
