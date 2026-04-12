"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { AncNotification, TaskFull } from "@/lib/types";
import { cn, formatRelativeTime, formatTimestamp } from "@/lib/utils";
import { NotificationItem } from "@/components/inbox/notification-item";
import {
  NotificationFilters,
  type InboxFilter,
} from "@/components/inbox/notification-filters";

export default function InboxPage() {
  const [filter, setFilter] = useState<InboxFilter>("unread");
  const [items, setItems] = useState<AncNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [preview, setPreview] = useState<TaskFull | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  // Load list when filter changes
  useEffect(() => {
    let aborted = false;
    setLoading(true);
    api.notifications
      .list(filter)
      .then((res) => {
        if (aborted) return;
        setItems(res.notifications);
        setUnreadCount(res.unreadCount);
        setSelectedIdx(0);
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
  }, [filter]);

  const selected = items[selectedIdx] ?? null;

  // Load preview when selection changes & has taskId
  useEffect(() => {
    if (!selected?.taskId) {
      setPreview(null);
      return;
    }
    let aborted = false;
    setPreviewLoading(true);
    api.tasks
      .getFull(selected.taskId)
      .then((t) => {
        if (!aborted) setPreview(t);
      })
      .catch(() => {
        if (!aborted) setPreview(null);
      })
      .finally(() => {
        if (!aborted) setPreviewLoading(false);
      });
    return () => {
      aborted = true;
    };
  }, [selected?.taskId]);

  const handleMarkRead = useCallback(async (id: number) => {
    setItems((prev) =>
      prev.map((n) => (n.id === id ? { ...n, readAt: Date.now() } : n)),
    );
    setUnreadCount((c) => Math.max(0, c - 1));
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
    setItems((prev) =>
      prev.map((n) => ({ ...n, readAt: n.readAt ?? Date.now() })),
    );
    setUnreadCount(0);
    try {
      await api.notifications.markAllRead();
    } catch {
      // ignore
    }
  }, []);

  // Keyboard navigation
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Ignore when typing in inputs
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;

      if (e.key === "j") {
        e.preventDefault();
        setSelectedIdx((i) => Math.min(items.length - 1, i + 1));
      } else if (e.key === "k") {
        e.preventDefault();
        setSelectedIdx((i) => Math.max(0, i - 1));
      } else if (e.key === "e") {
        e.preventDefault();
        const cur = items[selectedIdx];
        if (cur) handleArchive(cur.id);
      } else if (e.key === "m") {
        e.preventDefault();
        const cur = items[selectedIdx];
        if (cur && cur.readAt === null) handleMarkRead(cur.id);
      } else if (e.key === "Enter") {
        const cur = items[selectedIdx];
        if (cur?.taskId) {
          window.location.href = `/tasks/${cur.taskId}`;
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [items, selectedIdx, handleArchive, handleMarkRead]);

  // Scroll selected item into view
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-idx="${selectedIdx}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIdx]);

  const counts = useMemo(
    () => ({
      unread: filter === "unread" ? items.length : unreadCount,
    }),
    [filter, items.length, unreadCount],
  );

  return (
    <div className="flex h-full flex-col">
      {/* Page header */}
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            Inbox
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              {unreadCount} unread
            </span>
          </h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            <kbd className="rounded border border-border px-1 font-mono">j</kbd>/
            <kbd className="rounded border border-border px-1 font-mono">k</kbd> navigate ·
            <kbd className="ml-1 rounded border border-border px-1 font-mono">m</kbd> read ·
            <kbd className="ml-1 rounded border border-border px-1 font-mono">e</kbd> archive ·
            <kbd className="ml-1 rounded border border-border px-1 font-mono">↵</kbd> open
          </p>
        </div>
        <button
          onClick={handleMarkAll}
          className="rounded-lg border border-border bg-secondary/50 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          Mark all read
        </button>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-12">
        {/* Filter sidebar */}
        <aside className="col-span-2 border-r border-border bg-sidebar/40 px-4 py-4">
          <div className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Filters
          </div>
          <div className="flex flex-col gap-1.5">
            {(["unread", "all", "archive"] as InboxFilter[]).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={cn(
                  "flex items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors",
                  filter === f
                    ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
                )}
              >
                <span className="capitalize">{f}</span>
                {f === filter && (
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {items.length}
                  </span>
                )}
              </button>
            ))}
          </div>
        </aside>

        {/* List */}
        <section className="col-span-6 min-h-0 border-r border-border">
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <NotificationFilters
              value={filter}
              onChange={setFilter}
              counts={counts}
            />
          </div>
          <div ref={listRef} className="h-[calc(100%-49px)] overflow-y-auto">
            {loading && items.length === 0 && (
              <div className="p-6 text-sm text-muted-foreground">Loading…</div>
            )}
            {!loading && items.length === 0 && (
              <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
                <div className="text-5xl">✨</div>
                <p className="text-sm font-medium">All caught up</p>
                <p className="text-xs text-muted-foreground">
                  No {filter} notifications.
                </p>
              </div>
            )}
            <div className="divide-y divide-border/60">
              {items.map((n, idx) => (
                <div key={n.id} data-idx={idx}>
                  <NotificationItem
                    notification={n}
                    onMarkRead={handleMarkRead}
                    onArchive={handleArchive}
                    onClick={() => setSelectedIdx(idx)}
                    selected={idx === selectedIdx}
                    expanded
                  />
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Preview pane */}
        <aside className="col-span-4 min-h-0 overflow-y-auto bg-card/30 p-5">
          {!selected && (
            <p className="text-sm text-muted-foreground">
              Select a notification to preview.
            </p>
          )}
          {selected && (
            <div className="space-y-4">
              <div>
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {selected.kind} · {selected.severity}
                </div>
                <h2 className="text-base font-semibold">{selected.title}</h2>
                {selected.body && (
                  <p className="mt-1 text-sm text-muted-foreground">
                    {selected.body}
                  </p>
                )}
                <div className="mt-2 flex items-center gap-3 text-[11px] text-muted-foreground">
                  <span>{formatTimestamp(selected.createdAt)}</span>
                  <span>·</span>
                  <span>{formatRelativeTime(selected.createdAt)}</span>
                  {selected.agentRole && (
                    <>
                      <span>·</span>
                      <span className="font-mono">@{selected.agentRole}</span>
                    </>
                  )}
                </div>
              </div>

              {selected.taskId && (
                <div className="rounded-lg border border-border bg-card p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Linked Task
                    </div>
                    <Link
                      href={`/tasks/${selected.taskId}`}
                      className="text-[11px] text-primary hover:underline"
                    >
                      Open →
                    </Link>
                  </div>
                  {previewLoading && (
                    <p className="text-xs text-muted-foreground">Loading…</p>
                  )}
                  {!previewLoading && preview && (
                    <div className="space-y-2">
                      <p className="text-sm font-medium">{preview.task.title}</p>
                      {preview.task.description && (
                        <p className="line-clamp-3 text-xs text-muted-foreground">
                          {preview.task.description}
                        </p>
                      )}
                      <div className="flex items-center gap-2 text-[10px]">
                        <span className="rounded bg-secondary/60 px-1.5 py-0.5 font-mono uppercase">
                          {preview.task.state}
                        </span>
                        {preview.sessions.length > 0 && (
                          <span className="text-muted-foreground">
                            {preview.sessions.length} session
                            {preview.sessions.length === 1 ? "" : "s"}
                          </span>
                        )}
                        {preview.cost.totalUsd > 0 && (
                          <span className="font-mono text-muted-foreground">
                            ${preview.cost.totalUsd.toFixed(2)}
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                  {!previewLoading && !preview && (
                    <p className="text-xs text-muted-foreground">
                      Could not load task.
                    </p>
                  )}
                  <div className="mt-2 font-mono text-[10px] text-muted-foreground">
                    {selected.taskId}
                  </div>
                </div>
              )}

              <div className="flex gap-2">
                {selected.readAt === null && (
                  <button
                    onClick={() => handleMarkRead(selected.id)}
                    className="rounded-lg border border-border bg-secondary/50 px-3 py-1.5 text-xs hover:bg-secondary"
                  >
                    Mark read
                  </button>
                )}
                {selected.archivedAt === null && (
                  <button
                    onClick={() => handleArchive(selected.id)}
                    className="rounded-lg border border-border bg-secondary/50 px-3 py-1.5 text-xs hover:bg-secondary"
                  >
                    Archive
                  </button>
                )}
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
