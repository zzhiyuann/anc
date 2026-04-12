"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { AncNotification, WsMessage } from "@/lib/types";
import { cn } from "@/lib/utils";
import { NotificationItem } from "./notification-item";
import { NotificationFilters, type InboxFilter } from "./notification-filters";

interface InboxDrawerProps {
  open: boolean;
  onClose: () => void;
  /** Latest WS message — used to live-prepend new notifications. */
  lastMessage?: WsMessage | null;
}

export function InboxDrawer({ open, onClose, lastMessage }: InboxDrawerProps) {
  const [filter, setFilter] = useState<InboxFilter>("unread");
  const [items, setItems] = useState<AncNotification[]>([]);
  const [loading, setLoading] = useState(false);
  const [highlightId, setHighlightId] = useState<number | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Load list when opened or filter changes
  useEffect(() => {
    if (!open) return;
    let aborted = false;
    setLoading(true);
    api.notifications
      .list(filter)
      .then((res) => {
        if (aborted) return;
        setItems(res.notifications);
      })
      .catch(() => {
        if (aborted) return;
        setItems([]);
      })
      .finally(() => {
        if (!aborted) setLoading(false);
      });
    return () => {
      aborted = true;
    };
  }, [open, filter]);

  // Close on Esc
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Click outside
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      const el = panelRef.current;
      if (!el) return;
      if (!el.contains(e.target as Node)) onClose();
    };
    // Delay so the open click isn't captured.
    const id = setTimeout(() => {
      window.addEventListener("mousedown", onClick);
    }, 0);
    return () => {
      clearTimeout(id);
      window.removeEventListener("mousedown", onClick);
    };
  }, [open, onClose]);

  // Live-prepend new notifications
  useEffect(() => {
    if (!open || !lastMessage) return;
    if (lastMessage.type !== "notification:created") return;
    const data = lastMessage.data as { notification?: AncNotification } | AncNotification;
    const n: AncNotification | undefined =
      (data as { notification?: AncNotification }).notification ??
      (data as AncNotification);
    if (!n || typeof n.id !== "number") return;
    setItems((prev) => {
      if (prev.some((x) => x.id === n.id)) return prev;
      return [n, ...prev];
    });
    setHighlightId(n.id);
    const t = setTimeout(() => setHighlightId(null), 1400);
    return () => clearTimeout(t);
  }, [lastMessage, open]);

  const handleMarkRead = useCallback(async (id: number) => {
    setItems((prev) =>
      prev.map((n) => (n.id === id ? { ...n, readAt: Date.now() } : n)),
    );
    try {
      await api.notifications.markRead(id);
    } catch {
      // ignore
    }
  }, []);

  const handleArchive = useCallback(async (id: number) => {
    setItems((prev) => prev.filter((n) => n.id !== id));
    try {
      await api.notifications.archive(id);
    } catch {
      // ignore
    }
  }, []);

  const handleMarkAll = useCallback(async () => {
    setItems((prev) => prev.map((n) => ({ ...n, readAt: n.readAt ?? Date.now() })));
    try {
      await api.notifications.markAllRead();
    } catch {
      // ignore
    }
  }, []);

  const handleClick = useCallback(
    (n: AncNotification) => {
      if (n.readAt === null) handleMarkRead(n.id);
      if (n.taskId) {
        onClose();
      }
    },
    [handleMarkRead, onClose],
  );

  return (
    <>
      {/* Backdrop */}
      <div
        aria-hidden
        className={cn(
          "fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px] transition-opacity duration-200",
          open ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      />

      {/* Panel */}
      <aside
        ref={panelRef}
        role="dialog"
        aria-label="Inbox"
        className={cn(
          "fixed right-0 top-0 z-50 flex h-screen w-[420px] flex-col border-l border-border bg-background/95 shadow-2xl backdrop-blur-xl transition-transform duration-300 ease-out",
          open ? "translate-x-0" : "translate-x-full",
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold tracking-tight">Inbox</h2>
            <span className="rounded-full bg-secondary/60 px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
              {items.length}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleMarkAll}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Mark all read
            </button>
            <button
              onClick={onClose}
              aria-label="Close inbox"
              className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              <svg className="size-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M4 4l8 8M12 4l-8 8" />
              </svg>
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="border-b border-border px-5 py-2.5">
          <NotificationFilters value={filter} onChange={setFilter} />
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {loading && items.length === 0 && (
            <div className="p-5 text-sm text-muted-foreground">Loading…</div>
          )}
          {!loading && items.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
              <div className="text-4xl">✨</div>
              <p className="text-sm font-medium">All caught up</p>
              <p className="text-xs text-muted-foreground">
                No {filter === "unread" ? "unread" : filter} notifications.
              </p>
            </div>
          )}
          <div className="divide-y divide-border/60">
            {items.map((n) => (
              <NotificationItem
                key={n.id}
                notification={n}
                onMarkRead={handleMarkRead}
                onArchive={handleArchive}
                onClick={handleClick}
                highlight={highlightId === n.id}
              />
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-border px-5 py-3">
          <Link
            href="/inbox"
            onClick={onClose}
            className="flex items-center justify-between text-xs text-muted-foreground hover:text-foreground"
          >
            <span>Open full inbox</span>
            <svg className="size-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M6 4l4 4-4 4" />
            </svg>
          </Link>
        </div>
      </aside>
    </>
  );
}
