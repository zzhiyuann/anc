/**
 * Lifecycle commentator + AgentSession manager.
 *
 * Two responsibilities:
 * 1. Post status comments to Linear for traceability
 * 2. Create/dismiss AgentSessions for "Working..." badge
 *
 * AgentSession lifecycle:
 *   spawned  → create AgentSession  → Linear shows "Working..."
 *   idle     → dismiss AgentSession → "Working..." disappears
 *   resumed  → create new AgentSession → "Working..." reappears
 *   completed → dismiss (handled here, not on-complete)
 *   failed   → dismiss
 *   suspended → dismiss
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { bus } from '../bus.js';
import { addComment, createAgentSession, dismissSession, getIssue } from '../linear/client.js';
import { getSessionForIssue } from '../runtime/health.js';
import { postToDiscord, addReactions, replyInDiscord } from '../channels/discord.js';
import { getRootLink } from '../bridge/mappings.js';
import { getConfig } from '../linear/types.js';
import { createLogger } from '../core/logger.js';

const log = createLogger('lifecycle');

function isDutyIssue(issueKey: string): boolean {
  return issueKey.startsWith('pulse-') || issueKey.startsWith('postmortem-');
}

// Track which issues have had their "started" comment posted — prevents spam on re-spawns
const startedCommented = new Set<string>();

export function registerLifecycleHandlers(): void {
  // --- SPAWNED: comment (once only) + create AgentSession ("Working...") ---
  bus.on('agent:spawned', async ({ role, issueKey }) => {
    if (isDutyIssue(issueKey)) return;

    // Only post "started" comment on FIRST spawn for this issue, not re-spawns
    // Discord notification is handled by plan-announce (hook guard ensures it fires)
    if (!startedCommented.has(issueKey)) {
      startedCommented.add(issueKey);
      await addComment(issueKey, `**${role}** picked up this issue.`, role).catch(() => {});
    }

    // NOTE: We do NOT create AgentSession here.
    // Linear auto-creates one when we set delegateId in setIssueInProgress().
    // Creating a second one causes duplicate "Working..." badges.
    // We only handle DISMISSING sessions (in completion/fail/idle handlers).
  });

  // --- FAILED: comment + dismiss AgentSession + notify Discord ---
  bus.on('agent:failed', async ({ role, issueKey, error }) => {
    if (isDutyIssue(issueKey)) return;
    await addComment(issueKey, `**${role}** encountered an error:\n\n\`${error}\`\n\nCircuit breaker may delay retry.`, role).catch(() => {});
    await dismissLinearSession(issueKey, role);

    const msg = await postToDiscord(role, `failed on **${issueKey}**: \`${error.substring(0, 200)}\``);
    if (msg) await addReactions(msg, ['❌']);
  });

  // --- SUSPENDED: comment + dismiss AgentSession ---
  bus.on('agent:suspended', async ({ role, issueKey, reason }) => {
    if (isDutyIssue(issueKey)) return;
    await addComment(issueKey, `**${role}** suspended (${reason}). Will resume when a slot opens.`, role).catch(() => {});
    await dismissLinearSession(issueKey, role);
  });

  // --- RESUMED: comment only (Linear auto-creates AgentSession from delegate) ---
  bus.on('agent:resumed', async ({ role, issueKey }) => {
    if (isDutyIssue(issueKey)) return;
    await addComment(issueKey, `**${role}** resumed working.`, role).catch(() => {});
  });

  // --- IDLE: dismiss AgentSession (no comment — on-complete handles that) ---
  bus.on('agent:idle', async ({ role, issueKey }) => {
    if (isDutyIssue(issueKey)) return;
    log.debug(`${role}/${issueKey} → idle`);
    await dismissLinearSession(issueKey, role);
  });

  // --- COMPLETED: dismiss AgentSession + notify Discord ---
  bus.on('agent:completed', async ({ role, issueKey, handoff }) => {
    if (isDutyIssue(issueKey)) return;
    startedCommented.delete(issueKey);  // allow re-comment if issue is reopened later
    await dismissLinearSession(issueKey, role);

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

/** Dismiss ALL active AgentSessions for this issue (not just tracked one).
 *  Linear can create multiple sessions per issue (webhook + our createAgentSession).
 *  We must dismiss ALL of them to prevent orphaned "Working..." badges. */
async function dismissLinearSession(issueKey: string, role: string): Promise<void> {
  // 1. Dismiss the tracked session
  const tracked = getSessionForIssue(issueKey);
  if (tracked?.linearSessionId) {
    try {
      await dismissSession(tracked.linearSessionId, role);
      tracked.linearSessionId = undefined;
    } catch { /**/ }
  }

  // 2. Query and dismiss ALL active sessions for this issue
  try {
    const issue = await getIssue(issueKey);
    if (!issue) return;

    const token = readFileSync(join(homedir(), '.anc', 'agents', role, '.oauth-token'), 'utf-8').trim();
    const res = await fetch('https://api.linear.app/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({
        query: `{ agentSessions(filter: { issue: { id: { eq: "${issue.id}" } }, status: { in: ["active", "pending"] } }, first: 10) { nodes { id status } } }`,
      }),
    });
    const json = await res.json() as { data?: { agentSessions?: { nodes: Array<{ id: string }> } } };
    const sessions = json.data?.agentSessions?.nodes ?? [];

    for (const s of sessions) {
      try {
        await dismissSession(s.id, role);
      } catch { /**/ }
    }

    if (sessions.length > 0) {
      log.debug(`Dismissed ${sessions.length} AgentSession(s) for ${issueKey}`);
    }
  } catch (err) {
    log.debug(`Failed to dismiss all sessions: ${(err as Error).message}`);
  }
}
