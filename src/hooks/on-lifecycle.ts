/**
 * Lifecycle commentator — post status comments to Linear for traceability.
 *
 * AgentSession API has been removed. Agent status is communicated via
 * comments and issue status updates only.
 */

import { bus } from '../bus.js';
import { addComment } from '../linear/client.js';
import { postToDiscord, addReactions, replyInDiscord } from '../channels/discord.js';
import { getRootLink } from '../bridge/mappings.js';
import { createLogger } from '../core/logger.js';

const log = createLogger('lifecycle');

function isDutyIssue(issueKey: string): boolean {
  return issueKey.startsWith('pulse-') || issueKey.startsWith('postmortem-')
    || issueKey.startsWith('healthcheck-') || issueKey.startsWith('recovery-');
}

// Track which issues have had their "started" comment posted — prevents spam on re-spawns
const startedCommented = new Set<string>();

export function registerLifecycleHandlers(): void {
  // --- SPAWNED: comment (once only) ---
  bus.on('agent:spawned', async ({ role, issueKey }) => {
    if (isDutyIssue(issueKey)) return;

    if (!startedCommented.has(issueKey)) {
      startedCommented.add(issueKey);
      await addComment(issueKey, `**${role}** picked up this issue.`, role).catch(() => {});
    }
  });

  // --- FAILED: comment + notify Discord ---
  bus.on('agent:failed', async ({ role, issueKey, error }) => {
    if (isDutyIssue(issueKey)) return;
    await addComment(issueKey, `**${role}** encountered an error:\n\n\`${error}\`\n\nCircuit breaker may delay retry.`, role).catch(() => {});

    const msg = await postToDiscord(role, `failed on **${issueKey}**: \`${error.substring(0, 200)}\``);
    if (msg) await addReactions(msg, ['❌']);
  });

  // --- SUSPENDED: comment ---
  bus.on('agent:suspended', async ({ role, issueKey, reason }) => {
    if (isDutyIssue(issueKey)) return;
    await addComment(issueKey, `**${role}** suspended (${reason}). Will resume when a slot opens.`, role).catch(() => {});
  });

  // --- RESUMED: comment ---
  bus.on('agent:resumed', async ({ role, issueKey }) => {
    if (isDutyIssue(issueKey)) return;
    await addComment(issueKey, `**${role}** resumed working.`, role).catch(() => {});
  });

  // --- IDLE: no-op (on-complete handles the completion comment) ---
  bus.on('agent:idle', async ({ role, issueKey }) => {
    if (isDutyIssue(issueKey)) return;
    log.debug(`${role}/${issueKey} → idle`);
  });

  // --- COMPLETED: notify Discord ---
  bus.on('agent:completed', async ({ role, issueKey, handoff }) => {
    if (isDutyIssue(issueKey)) return;
    startedCommented.delete(issueKey);  // allow re-comment if issue is reopened later

    // Build clean completion message (not raw HANDOFF dump)
    const summary = formatCompletionSummary(handoff, issueKey);
    const rootLink = getRootLink(issueKey);
    const target = rootLink
      ? async () => replyInDiscord(rootLink.discordMessageId, rootLink.discordChannelId, `**[${role}]** ✅ **${issueKey}** done\n${summary}`)
      : async () => postToDiscord(role, `✅ **${issueKey}** done\n${summary}`);

    const msg = await target();
    if (msg) {
      const hasWarning = /quality check warnings/i.test(handoff);
      if (hasWarning) await addReactions(msg, ['⚠️']);
    }
  });
}

/** Reset module state (for testing) */
export function _resetLifecycle(): void {
  startedCommented.clear();
}

/** Base URL for serving workspace docs (Tailscale-accessible) */
const DOC_BASE = `http://100.89.67.80:${process.env.ANC_WEBHOOK_PORT || 3849}/docs`;

/** Strip markdown formatting — Discord renders it as rich text which looks terrible */
function stripMd(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gm, '')     // # headers
    .replace(/\*\*(.+?)\*\*/g, '$1') // **bold**
    .replace(/\*(.+?)\*/g, '$1')     // *italic*
    .replace(/`([^`]+)`/g, '$1')     // `code`
    .replace(/^[-*]\s+/gm, '- ')     // normalize bullets
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // [text](url) → text
    .trim();
}

/** Convert raw HANDOFF.md into a clean plain-text Discord summary */
function formatCompletionSummary(handoff: string, issueKey: string): string {
  const lines = handoff.split('\n');
  const bullets: string[] = [];

  // Extract summary section (between ## Summary and next ##)
  let inSummary = false;
  for (const line of lines) {
    if (/^##?\s*Summary/i.test(line)) { inSummary = true; continue; }
    if (inSummary && /^##/.test(line)) break;
    if (inSummary) {
      const trimmed = line.trim();
      if (trimmed.length > 0) bullets.push(stripMd(trimmed));
    }
  }

  // If no summary section, take first meaningful lines
  if (bullets.length === 0) {
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('#') || trimmed.length === 0) continue;
      if (trimmed.startsWith('---')) continue;
      bullets.push(stripMd(trimmed));
      if (bullets.length >= 3) break;
    }
  }

  const result = bullets
    .slice(0, 5)
    .map(b => b.startsWith('- ') ? b : `- ${b}`)
    .join('\n');

  return result || 'Completed (see Linear for details)';
}
