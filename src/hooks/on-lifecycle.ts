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

import { bus } from '../bus.js';
import { addComment, createAgentSession, dismissSession, getIssue } from '../linear/client.js';
import { getSessionForIssue } from '../runtime/health.js';
import { postToDiscord, addReactions } from '../channels/discord.js';
import { createLogger } from '../core/logger.js';

const log = createLogger('lifecycle');

function isDutyIssue(issueKey: string): boolean {
  return issueKey.startsWith('pulse-') || issueKey.startsWith('postmortem-');
}

export function registerLifecycleHandlers(): void {
  // --- SPAWNED: comment + create AgentSession ("Working...") ---
  bus.on('agent:spawned', async ({ role, issueKey }) => {
    if (isDutyIssue(issueKey)) return;

    // Post lifecycle comment
    await addComment(issueKey, `**${role}** started working on this issue.`, role).catch(() => {});

    // Create AgentSession → "Working..." badge
    try {
      const issue = await getIssue(issueKey);
      if (issue) {
        const sessionId = await createAgentSession(issue.id, role);
        if (sessionId) {
          // Store the Linear session ID for later dismissal
          const tracked = getSessionForIssue(issueKey);
          if (tracked) tracked.linearSessionId = sessionId;
          log.debug(`AgentSession created for ${issueKey}: ${sessionId}`);
        }
      }
    } catch (err) {
      log.debug(`Failed to create AgentSession: ${(err as Error).message}`);
    }
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

  // --- RESUMED: comment + create new AgentSession ---
  bus.on('agent:resumed', async ({ role, issueKey }) => {
    if (isDutyIssue(issueKey)) return;
    await addComment(issueKey, `**${role}** resumed working.`, role).catch(() => {});

    try {
      const issue = await getIssue(issueKey);
      if (issue) {
        const sessionId = await createAgentSession(issue.id, role);
        if (sessionId) {
          const tracked = getSessionForIssue(issueKey);
          if (tracked) tracked.linearSessionId = sessionId;
        }
      }
    } catch { /**/ }
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
    await dismissLinearSession(issueKey, role);

    // Post completion summary to Discord with emoji reactions
    const summary = handoff.length > 300 ? handoff.substring(0, 300) + '...' : handoff;
    const msg = await postToDiscord(role, `completed **${issueKey}**\n${summary}`);
    if (msg) {
      const hasWarning = /quality check warnings/i.test(handoff);
      const emojis = hasWarning ? ['✅', '⚠️'] : ['✅'];
      await addReactions(msg, emojis);
    }
  });
}

/** Dismiss the Linear AgentSession (removes "Working..." badge) */
async function dismissLinearSession(issueKey: string, role: string): Promise<void> {
  const tracked = getSessionForIssue(issueKey);
  if (!tracked?.linearSessionId) return;

  try {
    await dismissSession(tracked.linearSessionId, role);
    tracked.linearSessionId = undefined;
    log.debug(`AgentSession dismissed for ${issueKey}`);
  } catch (err) {
    log.debug(`Failed to dismiss AgentSession: ${(err as Error).message}`);
  }
}
