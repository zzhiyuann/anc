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
    const set = this.listeners.get(event)!;
    set.add(listener as Listener<unknown>);
    // Return unsubscribe function
    return () => set.delete(listener as Listener<unknown>);
  }

  async emit<K extends keyof Events & string>(event: K, data: Events[K]): Promise<void> {
    const set = this.listeners.get(event);
    if (!set || set.size === 0) return;

    // Run all handlers concurrently — errors are logged, never propagated
    const results = await Promise.allSettled(
      [...set].map(fn => Promise.resolve(fn(data)))
    );

    for (const r of results) {
      if (r.status === 'rejected') {
        log.error(`Handler error on "${event}": ${r.reason}`);
      }
    }
  }

  off<K extends keyof Events & string>(event: K): void {
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
  'webhook:session.created': { session: import('./linear/types.js').SessionPayload };
  'webhook:session.prompted': { session: import('./linear/types.js').SessionPayload; prompt: string };

  // Discord-originated events
  'discord:message': { content: string; authorId: string; channelId: string; messageId: string };

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
}

// Singleton bus instance
export const bus = new TypedEventBus<AncEvents>();

export { TypedEventBus };
