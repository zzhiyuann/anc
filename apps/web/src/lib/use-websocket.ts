"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { WsEvent } from "./types";

interface UseWebSocketOptions {
  url?: string;
  reconnectInterval?: number;
  maxRetries?: number;
}

interface UseWebSocketReturn {
  connected: boolean;
  lastEvent: WsEvent | null;
  events: WsEvent[];
  send: (data: unknown) => void;
}

export function useWebSocket(options: UseWebSocketOptions = {}): UseWebSocketReturn {
  const {
    url = "ws://localhost:3848/ws",
    reconnectInterval = 3000,
    maxRetries = 10,
  } = options;

  const [connected, setConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState<WsEvent | null>(null);
  const [events, setEvents] = useState<WsEvent[]>([]);

  const wsRef = useRef<WebSocket | null>(null);
  const retriesRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        retriesRef.current = 0;
      };

      ws.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data) as WsEvent;
          setLastEvent(parsed);
          setEvents((prev) => [parsed, ...prev].slice(0, 200));
        } catch {
          // Ignore malformed messages
        }
      };

      ws.onclose = () => {
        setConnected(false);
        wsRef.current = null;

        if (retriesRef.current < maxRetries) {
          retriesRef.current += 1;
          timerRef.current = setTimeout(connect, reconnectInterval);
        }
      };

      ws.onerror = () => {
        ws.close();
      };
    } catch {
      // Connection failed, will retry via onclose
    }
  }, [url, reconnectInterval, maxRetries]);

  const send = useCallback((data: unknown) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    }
  }, []);

  useEffect(() => {
    connect();

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      wsRef.current?.close();
    };
  }, [connect]);

  return { connected, lastEvent, events, send };
}
