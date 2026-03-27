/**
 * Lifecycle commentator — posts status comments to Linear for full traceability.
 *
 * Every lifecycle event becomes visible on the issue:
 *   spawned   → "Engineer started working"
 *   failed    → "Engineer hit an error: ..."
 *   suspended → "Engineer suspended (capacity)"
 *   resumed   → "Engineer resumed"
 *   idle      → "Engineer finished (no HANDOFF — conversation/lightweight)"
 *   completed → HANDOFF comment (handled by on-complete.ts, not here)
 */

import { bus } from '../bus.js';
import { addComment } from '../linear/client.js';
import chalk from 'chalk';

export function registerLifecycleHandlers(): void {
  bus.on('agent:spawned', async ({ role, issueKey }) => {
    // Don't comment on duty sessions (pulse, postmortem)
    if (issueKey.startsWith('pulse-') || issueKey.startsWith('postmortem-')) return;
    await addComment(issueKey, `**${role}** started working on this issue.`, role).catch(() => {});
  });

  bus.on('agent:failed', async ({ role, issueKey, error }) => {
    if (issueKey.startsWith('pulse-') || issueKey.startsWith('postmortem-')) return;
    await addComment(issueKey, `**${role}** encountered an error:\n\n\`${error}\`\n\nCircuit breaker may delay retry.`, role).catch(() => {});
  });

  bus.on('agent:suspended', async ({ role, issueKey, reason }) => {
    if (issueKey.startsWith('pulse-') || issueKey.startsWith('postmortem-')) return;
    await addComment(issueKey, `**${role}** suspended (${reason}). Will resume when a slot opens.`, role).catch(() => {});
  });

  bus.on('agent:resumed', async ({ role, issueKey }) => {
    if (issueKey.startsWith('pulse-') || issueKey.startsWith('postmortem-')) return;
    await addComment(issueKey, `**${role}** resumed working.`, role).catch(() => {});
  });

  bus.on('agent:idle', async ({ role, issueKey }) => {
    if (issueKey.startsWith('pulse-') || issueKey.startsWith('postmortem-')) return;
    // Don't post for idle if HANDOFF was already processed (on-complete handles that)
    // This only fires for lightweight completions (conversations, no HANDOFF)
    console.log(chalk.dim(`[lifecycle] ${role}/${issueKey} → idle`));
  });
}
