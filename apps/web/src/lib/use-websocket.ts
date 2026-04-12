"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { WsMessage, WsSnapshot } from "./types";

// WebSocket upgrades can't be proxied through Next.js rewrites, so we connect
// directly to the anc gateway. Override via NEXT_PUBLIC_WS_URL in .env.local.
const DEFAULT_WS_URL =
  process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:3848/ws";

interface UseWebSocketOptions {
  url?: string;
  maxRetries?: number;
  maxBackoffMs?: number;
  onMessage?: (msg: WsMessage) => void;
}

/**
 * Wave 2C: WS event types relevant to live task updates.
 * The dashboard's task detail page filters on these via subscribeToTask().
 *
 *   task:created     — new task entity created
 *   task:commented   — new comment on a task
 *   task:dispatched  — additional agent attached to a task
 *   task:completed   — task moved to done/failed/canceled
 *   notification:created — new inbox notification
 *   agent:process-event  — Wave 2B live activity stream item
 *
 * Plus all existing agent:* / queue:* / system:* / webhook:* events.
 */
export const TASK_SCOPED_EVENT_TYPES: ReadonlySet<string> = new Set([
  "task:created",
  "task:commented",
  "task:dispatched",
  "task:completed",
  "agent:process-event",
  "agent:spawned",
  "agent:completed",
  "agent:failed",
  "agent:idle",
  "agent:suspended",
  "agent:resumed",
]);

/** Type guard: does this WS message carry a taskId we can filter on? */
function messageTaskId(msg: WsMessage): string | null {
  const data = msg.data as { taskId?: unknown; issueKey?: unknown } | null | undefined;
  if (!data || typeof data !== "object") return null;
  if (typeof data.taskId === "string") return data.taskId;
  // Legacy: many backend events still use issueKey as the task identifier.
  if (typeof data.issueKey === "string") return data.issueKey;
  return null;
}

interface UseWebSocketReturn {
  connected: boolean;
  snapshot: WsSnapshot | null;
  lastMessage: WsMessage | null;
  events: WsMessage[];
  send: (data: unknown) => void;
  reconnect: () => void;
  /**
   * Subscribe to WS messages scoped to a single task. The callback fires
   * for any message whose `data.taskId` (or legacy `data.issueKey`) matches.
   * Returns an unsubscribe function — call it on unmount.
   */
  subscribeToTask: (
    taskId: string,
    cb: (msg: WsMessage) => void,
  ) => () => void;
}

export function useWebSocket(options: UseWebSocketOptions = {}): UseWebSocketReturn {
  const {
    url = DEFAULT_WS_URL,
    maxRetries = 20,
    maxBackoffMs = 30_000,
    onMessage,
  } = options;

  const [connected, setConnected] = useState(false);
  const [snapshot, setSnapshot] = useState<WsSnapshot | null>(null);
  const [lastMessage, setLastMessage] = useState<WsMessage | null>(null);
  const [events, setEvents] = useState<WsMessage[]>([]);

  const wsRef = useRef<WebSocket | null>(null);
  const retriesRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unmountedRef = useRef(false);
  const onMessageRef = useRef(onMessage);

  // Per-task subscriber registry: taskId → set of callbacks.
  // Stable across renders so subscribeToTask returns can be safely captured.
  const taskSubscribersRef = useRef<Map<string, Set<(msg: WsMessage) => void>>>(
    new Map(),
  );

  // Keep the callback fresh without retriggering the connect effect.
  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

  const connect = useCallback(() => {
    if (unmountedRef.current) return;
    if (
      wsRef.current &&
      (wsRef.current.readyState === WebSocket.OPEN ||
        wsRef.current.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      // Constructor can throw for invalid URLs — schedule a retry.
      scheduleReconnect();
      return;
    }
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      retriesRef.current = 0;
    };

    ws.onmessage = (event) => {
      const raw = typeof event.data === "string" ? event.data : "";
      if (raw === "pong") return;
      try {
        const msg = JSON.parse(raw) as WsMessage;
        setLastMessage(msg);
        if (msg.type === "snapshot") {
          setSnapshot(msg.data as WsSnapshot);
        } else {
          setEvents((prev) => [msg, ...prev].slice(0, 200));
        }
        onMessageRef.current?.(msg);

        // Fan out to per-task subscribers (Wave 2C: task detail page).
        const tid = messageTaskId(msg);
        if (tid) {
          const subs = taskSubscribersRef.current.get(tid);
          if (subs && subs.size > 0) {
            for (const cb of subs) {
              try {
                cb(msg);
              } catch {
                // A misbehaving subscriber must not break the WS pipeline.
              }
            }
          }
        }
      } catch {
        // Ignore malformed messages
      }
    };

    ws.onclose = () => {
      setConnected(false);
      wsRef.current = null;
      scheduleReconnect();
    };

    ws.onerror = () => {
      // Let onclose handle reconnection.
      try {
        ws.close();
      } catch {
        // ignore
      }
    };
  }, [url]);

  const scheduleReconnect = useCallback(() => {
    if (unmountedRef.current) return;
    if (retriesRef.current >= maxRetries) return;

    const retries = retriesRef.current++;
    const backoff = Math.min(1000 * Math.pow(2, retries), maxBackoffMs);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => connect(), backoff);
  }, [connect, maxRetries, maxBackoffMs]);

  const send = useCallback((data: unknown) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(typeof data === "string" ? data : JSON.stringify(data));
    }
  }, []);

  const subscribeToTask = useCallback(
    (taskId: string, cb: (msg: WsMessage) => void): (() => void) => {
      let bucket = taskSubscribersRef.current.get(taskId);
      if (!bucket) {
        bucket = new Set();
        taskSubscribersRef.current.set(taskId, bucket);
      }
      bucket.add(cb);
      return () => {
        const b = taskSubscribersRef.current.get(taskId);
        if (!b) return;
        b.delete(cb);
        if (b.size === 0) taskSubscribersRef.current.delete(taskId);
      };
    },
    [],
  );

  const reconnect = useCallback(() => {
    retriesRef.current = 0;
    if (timerRef.current) clearTimeout(timerRef.current);
    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch {
        // ignore
      }
      wsRef.current = null;
    }
    connect();
  }, [connect]);

  useEffect(() => {
    unmountedRef.current = false;
    connect();
    return () => {
      unmountedRef.current = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      if (wsRef.current) {
        try {
          wsRef.current.close();
        } catch {
          // ignore
        }
        wsRef.current = null;
      }
    };
  }, [connect]);

  return { connected, snapshot, lastMessage, events, send, reconnect, subscribeToTask };
}
