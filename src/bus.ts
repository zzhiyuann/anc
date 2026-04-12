/**
 * Typed event bus — the nervous system of ANC.
 * All components communicate through this bus.
 * Handlers run concurrently — no single handler blocks others.
 */

import { createLogger } from './core/logger.js';

const log = createLogger('bus');

type Listener<T> = (data: T) => void | Promise<void>;

class TypedEventBus<Events> {
  private listeners = new Map<string, Set<Listener<unknown>>>();

  on<K extends keyof Events & string>(event: K, listener: Listener<Events[K]>): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    const listeners = this.listeners.get(event)!;
    listeners.add(listener as Listener<unknown>);
    // Return unsubscribe function
    return () => listeners.delete(listener as Listener<unknown>);
  }

  async emit<K extends keyof Events & string>(event: K, data: Events[K]): Promise<void> {
    const listeners = this.listeners.get(event);
    if (!listeners || listeners.size === 0) return;

    // Run all handlers concurrently — errors are logged, never propagated
    const results = await Promise.allSettled(
      [...listeners].map(fn => Promise.resolve(fn(data)))
    );

    for (const r of results) {
      if (r.status === 'rejected') {
        log.error(`Handler error on "${event}": ${r.reason}`);
      }
    }
  }

  /** Remove a specific listener for an event */
  off<K extends keyof Events & string>(event: K, listener: Listener<Events[K]>): void {
    this.listeners.get(event)?.delete(listener as Listener<unknown>);
  }

  /** Remove all listeners for an event */
  removeAllListeners<K extends keyof Events & string>(event: K): void {
    this.listeners.delete(event);
  }

  listenerCount(event: string): number {
    return this.listeners.get(event)?.size ?? 0;
  }
}

// --- ANC Event Types ---

export interface AncEvents {
  // Webhook-originated events
  'webhook:issue.created': { issue: import('./linear/types.js').IssuePayload };
  'webhook:issue.updated': { issue: import('./linear/types.js').IssuePayload; changes: Record<string, unknown> };
  'webhook:comment.created': { comment: import('./linear/types.js').CommentPayload; issue: import('./linear/types.js').IssuePayload };
  // Discord-originated events
  'discord:message': { content: string; authorId: string; channelId: string; messageId: string; isReply: boolean; referencedMessageId?: string };

  // Agent lifecycle events
  'agent:spawned': { role: string; issueKey: string; tmuxSession: string };
  'agent:completed': { role: string; issueKey: string; handoff: string };
  'agent:failed': { role: string; issueKey: string; error: string };
  'agent:idle': { role: string; issueKey: string };
  'agent:suspended': { role: string; issueKey: string; reason: string };
  'agent:resumed': { role: string; issueKey: string; tmuxSession: string };
  'agent:health': { role: string; alive: boolean; tmuxSession: string };

  // Queue events
  'queue:enqueued': { issueKey: string; role: string; priority: number };
  'queue:drain': undefined;

  // System events
  'system:tick': { timestamp: number };  // periodic health check
  'system:budget-alert': { agentRole?: string; spent: number; limit: number; percent: number };

  // Task-level events (first-class Task entity)
  'task:created': { taskId: string; projectId: string | null; title: string; source: string };
  'task:commented': { taskId: string; author: string; body: string; commentId: number };
  'task:dispatched': { taskId: string; role: string; parentTaskId: string | null };
  'task:completed': { taskId: string; handoffSummary: string | null };

  // Notification events
  'notification:created': { id: number; kind: string; severity: string; title: string; taskId?: string | null };

  // -- Wave 2B: Claude Code hook process-capture events --
  'agent:process-event': { taskId: string; role: string; eventType: string; preview: string };
}

// Singleton bus instance
export const bus = new TypedEventBus<AncEvents>();

export { TypedEventBus };
