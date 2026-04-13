"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { AncNotification, WsMessage } from "@/lib/types";

interface NotificationBellProps {
  /** Latest WS message piped from AppShell to drive live updates. */
  lastMessage?: WsMessage | null;
}

export function NotificationBell({ lastMessage }: NotificationBellProps) {
  const [count, setCount] = useState(0);
  const [pulse, setPulse] = useState(false);
  const [toast, setToast] = useState<{ id: number; title: string } | null>(null);
  const lastSeenIdRef = useRef<number | null>(null);

  useEffect(() => {
    let aborted = false;
    api.notifications
      .unreadCount()
      .then((c) => {
        if (!aborted) setCount(c);
      })
      .catch(() => {});
    return () => {
      aborted = true;
    };
  }, []);

  useEffect(() => {
    if (!lastMessage) return;
    if (lastMessage.type !== "notification:created") return;
    const data = lastMessage.data as { notification?: AncNotification } | AncNotification;
    const n: AncNotification | undefined =
      (data as { notification?: AncNotification }).notification ??
      (data as AncNotification);
    if (!n || typeof n.id !== "number") return;
    if (lastSeenIdRef.current === n.id) return;
    lastSeenIdRef.current = n.id;

    setCount((c) => c + 1);
    setPulse(true);
    const t1 = setTimeout(() => setPulse(false), 1500);

    setToast({ id: n.id, title: n.title });
    const t2 = setTimeout(() => setToast(null), 4000);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [lastMessage]);

  return (
    <>
      <Link
        href="/inbox"
        aria-label="Open inbox"
        className={cn(
          "relative rounded-lg p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground",
          pulse && "animate-pulse text-foreground",
        )}
      >
        <svg
          className="size-4"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <path d="M8 2a4 4 0 0 0-4 4v2l-1 2h10l-1-2V6a4 4 0 0 0-4-4zM6.5 12.5a1.5 1.5 0 0 0 3 0" />
        </svg>
        {count > 0 && (
          <span
            className={cn(
              "absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-status-failed px-1 font-mono text-[9px] font-bold text-white",
              pulse && "ring-2 ring-status-failed/40",
            )}
          >
            {count > 99 ? "99+" : count}
          </span>
        )}
        {pulse && count === 0 && (
          <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-status-active ring-2 ring-status-active/40" />
        )}
      </Link>

      {toast && (
        <div className="fixed bottom-6 right-6 z-[60] max-w-sm animate-in slide-in-from-bottom-2 rounded-lg border border-border bg-card px-4 py-3 shadow-2xl">
          <div className="flex items-start gap-3">
            <div className="text-lg leading-none">🔔</div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-muted-foreground">
                New notification
              </p>
              <p className="mt-0.5 truncate text-sm">{toast.title}</p>
            </div>
            <button
              onClick={() => setToast(null)}
              className="rounded p-0.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
              aria-label="Dismiss"
            >
              <svg className="size-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 4l8 8M12 4l-8 8" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </>
  );
}
