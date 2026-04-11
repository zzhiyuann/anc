/**
 * Session handler — DEPRECATED.
 *
 * AgentSession API has been removed. Agent work is now triggered by:
 *   - webhook:issue.created → on-issue.ts → route → resolve
 *   - webhook:comment.created → on-comment.ts → route → resolve
 *
 * This file is kept as a no-op to avoid import errors from index.ts.
 * Remove the import from index.ts when convenient.
 */

export function registerSessionHandlers(): void {
  // No-op: AgentSession webhooks are now ignored at the gateway level.
  // All agent triggering flows through on-issue.ts and on-comment.ts.
}
