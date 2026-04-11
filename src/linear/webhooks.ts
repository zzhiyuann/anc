/**
 * Webhook payload parsing and signature verification.
 */

import { createHmac } from 'crypto';
import type { WebhookPayload, IssuePayload, CommentPayload, SessionPayload } from './types.js';

/** Verify Linear webhook HMAC-SHA256 signature */
export function verifySignature(body: string, signature: string | undefined, secret: string | undefined): boolean {
  if (!secret) return true;  // verification disabled
  if (!signature) return false;
  const expected = createHmac('sha256', secret).update(body).digest('hex');
  if (expected.length !== signature.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) {
    mismatch |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return mismatch === 0;
}

export type ClassifiedEvent =
  | { type: 'issue.created'; issue: IssuePayload }
  | { type: 'issue.updated'; issue: IssuePayload; changes: Record<string, unknown> }
  | { type: 'comment.created'; comment: CommentPayload; issue: IssuePayload }
  | { type: 'session.created'; session: SessionPayload }
  | { type: 'session.prompted'; session: SessionPayload; prompt: string }
  | { type: 'ignored'; reason: string };

/** Classify a raw Linear webhook payload into a typed event */
export function classifyWebhook(event: string, payload: WebhookPayload): ClassifiedEvent {
  const { action, data } = payload;

  // Agent session events — ignored (comment-based sync replaces AgentSession API)
  if (event === 'AgentSession' || data.type === 'AgentSession') {
    return { type: 'ignored', reason: `AgentSession events disabled (using comment-based sync)` };
  }

  // Comment events
  if (event === 'Comment' && action === 'create') {
    const comment: CommentPayload = {
      id: data.id as string,
      body: data.body as string,
      issueId: (data.issueId ?? (data.issue as Record<string, unknown>)?.id) as string,
      userId: (data.userId ?? (data.user as Record<string, unknown>)?.id) as string,
      parentId: data.parentId as string | undefined,
    };
    if (!comment.issueId) return { type: 'ignored', reason: 'comment without issue' };

    // Build a minimal issue payload from the comment context
    const issueData = data.issue as Record<string, unknown> | undefined;
    const issue: IssuePayload = {
      id: comment.issueId,
      identifier: (issueData?.identifier ?? '') as string,
      title: (issueData?.title ?? '') as string,
      priority: (issueData?.priority ?? 3) as number,
    };

    return { type: 'comment.created', comment, issue };
  }

  // Issue events
  if (event === 'Issue') {
    const issue: IssuePayload = {
      id: data.id as string,
      identifier: data.identifier as string,
      title: data.title as string,
      description: data.description as string | undefined,
      priority: (data.priority ?? 3) as number,
      labels: Array.isArray(data.labels)
        ? (data.labels as Array<Record<string, unknown>>).map(l => (l.name ?? l) as string)
        : [],
      state: typeof data.state === 'object' && data.state !== null
        ? (data.state as Record<string, unknown>).name as string
        : data.state as string | undefined,
      project: typeof data.project === 'object' && data.project !== null
        ? (data.project as Record<string, unknown>).name as string
        : data.project as string | undefined,
      assigneeId: data.assigneeId as string | undefined,
      delegateId: data.delegateId as string | undefined,
      parentId: data.parentId as string | undefined,
    };

    if (action === 'create') return { type: 'issue.created', issue };
    if (action === 'update') {
      const changes = (payload as unknown as Record<string, unknown>).updatedFrom as Record<string, unknown> ?? {};
      return { type: 'issue.updated', issue, changes };
    }
  }

  return { type: 'ignored', reason: `${event}:${action}` };
}
