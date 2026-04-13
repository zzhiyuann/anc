"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { AncNotification, NotificationKind } from "@/lib/types";
import { cn, formatRelativeTime, formatTimestamp } from "@/lib/utils";
import {
  NotificationFilters,
  backendFilterFor,
  type InboxFilter,
} from "@/components/inbox/notification-filters";

const KIND_LETTER: Record<NotificationKind, string> = {
  mention: "M",
  alert: "A",
  briefing: "B",
  completion: "C",
  failure: "F",
  dispatch: "D",
  queue: "Q",
  budget: "$",
  a2a: "↔",
};

function avatarBgFor(kind: NotificationKind): string {
  switch (kind) {
    case "alert":
    case "failure":
      return "bg-status-failed/15 text-status-failed";
    case "completion":
      return "bg-status-active/15 text-status-active";
    case "mention":
      return "bg-primary/15 text-primary";
    case "briefing":
      return "bg-amber-500/15 text-amber-600 dark:text-amber-400";
    default:
      return "bg-secondary text-muted-foreground";
  }
}

function applyClientFilter(
  items: AncNotification[],
  filter: InboxFilter,
): AncNotification[] {
  switch (filter) {
    case "mentions":
      return items.filter((n) => n.kind === "mention");
    case "alerts":
      return items.filter((n) => n.kind === "alert" || n.kind === "failure");
    case "briefings":
      return items.filter((n) => n.kind === "briefing");
    default:
      return items;
  }
}

export default function InboxPage() {
  const [filter, setFilter] = useState<InboxFilter>("all");
  const [rawItems, setRawItems] = useState<AncNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [reply, setReply] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  // Load list when backend filter changes
  useEffect(() => {
    let aborted = false;
    setLoading(true);
    const backend = backendFilterFor(filter);
    api.notifications
      .list(backend)
      .then((res) => {
        if (aborted) return;
        setRawItems(res.notifications);
        setUnreadCount(res.unreadCount);
      })
      .catch(() => {
        if (aborted) return;
        setRawItems([]);
      })
      .finally(() => {
        if (!aborted) setLoading(false);
      });
    return () => {
      aborted = true;
    };
  }, [filter]);

  const items = useMemo(() => applyClientFilter(rawItems, filter), [rawItems, filter]);

  // Maintain valid selection
  useEffect(() => {
    if (items.length === 0) {
      setSelectedId(null);
      return;
    }
    if (selectedId === null || !items.some((n) => n.id === selectedId)) {
      setSelectedId(items[0].id);
    }
  }, [items, selectedId]);

  const selectedIdx = selectedId === null ? -1 : items.findIndex((n) => n.id === selectedId);
  const selected = selectedIdx >= 0 ? items[selectedIdx] : null;

  const counts: Partial<Record<InboxFilter, number>> = useMemo(() => {
    return {
      unread: rawItems.filter((n) => n.readAt === null).length,
      mentions: rawItems.filter((n) => n.kind === "mention").length,
      alerts: rawItems.filter((n) => n.kind === "alert" || n.kind === "failure").length,
      briefings: rawItems.filter((n) => n.kind === "briefing").length,
    };
  }, [rawItems]);

  const handleMarkRead = useCallback(async (id: number) => {
    setRawItems((prev) =>
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
    setRawItems((prev) => prev.filter((n) => n.id !== id));
    try {
      await api.notifications.archive(id);
    } catch {
      // ignore
    }
  }, []);

  const handleMarkAll = useCallback(async () => {
    setRawItems((prev) =>
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
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if ((e.target as HTMLElement | null)?.isContentEditable) return;

      if (e.key === "j") {
        e.preventDefault();
        if (items.length === 0) return;
        const next = Math.min(items.length - 1, Math.max(0, selectedIdx + 1));
        setSelectedId(items[next].id);
      } else if (e.key === "k") {
        e.preventDefault();
        if (items.length === 0) return;
        const next = Math.max(0, selectedIdx - 1);
        setSelectedId(items[next].id);
      } else if (e.key === "e") {
        e.preventDefault();
        if (selected) handleArchive(selected.id);
      } else if (e.key === "m") {
        e.preventDefault();
        if (selected && selected.readAt === null) handleMarkRead(selected.id);
      } else if (e.key === "r") {
        e.preventDefault();
        const ta = document.getElementById("inbox-reply") as HTMLTextAreaElement | null;
        ta?.focus();
      } else if (e.key === "Enter") {
        if (selected?.taskId) {
          window.location.href = `/tasks/${selected.taskId}`;
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [items, selected, selectedIdx, handleArchive, handleMarkRead]);

  // Scroll selected into view
  useEffect(() => {
    if (selectedIdx < 0) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${selectedIdx}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIdx]);

  // Reset reply when selection changes
  useEffect(() => {
    setReply("");
  }, [selectedId]);

  return (
    <div className="flex h-full min-h-0">
      {/* Left: list */}
      <section className="flex w-[380px] shrink-0 flex-col border-r border-border">
        {/* Header */}
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
          <div className="flex items-baseline gap-2">
            <h1 className="text-[14px] font-semibold tracking-tight">Inbox</h1>
            {unreadCount > 0 && (
              <span className="font-mono text-[11px] text-muted-foreground">
                {unreadCount} unread
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={handleMarkAll}
            className="rounded-md px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            Mark all read
          </button>
        </div>

        {/* Filter tabs */}
        <div className="flex shrink-0 items-center border-b border-border px-2 py-1.5">
          <NotificationFilters value={filter} onChange={setFilter} counts={counts} />
        </div>

        {/* List */}
        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto">
          {loading && items.length === 0 && (
            <div className="p-6 text-[12px] text-muted-foreground">Loading…</div>
          )}
          {!loading && items.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center gap-1 px-6 text-center">
              <p className="text-[13px] font-medium">All caught up</p>
              <p className="text-[11px] text-muted-foreground">
                No {filter} notifications.
              </p>
            </div>
          )}
          <ul className="divide-y divide-border/60">
            {items.map((n, idx) => {
              const isSelected = n.id === selectedId;
              const isUnread = n.readAt === null;
              return (
                <li
                  key={n.id}
                  data-idx={idx}
                  onClick={() => setSelectedId(n.id)}
                  className={cn(
                    "relative flex cursor-pointer items-start gap-2.5 px-3 py-2.5 transition-colors",
                    isSelected
                      ? "bg-secondary/70"
                      : "hover:bg-secondary/40",
                  )}
                >
                  {isUnread && (
                    <span className="absolute left-1 top-3 size-1.5 rounded-full bg-primary" />
                  )}
                  <div
                    className={cn(
                      "flex size-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
                      avatarBgFor(n.kind),
                    )}
                  >
                    {KIND_LETTER[n.kind] ?? "•"}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <h3
                        className={cn(
                          "min-w-0 flex-1 truncate text-[12.5px]",
                          isUnread ? "font-semibold text-foreground" : "text-foreground/75",
                        )}
                      >
                        {n.title}
                      </h3>
                      <time className="shrink-0 font-mono text-[10px] text-muted-foreground">
                        {formatRelativeTime(n.createdAt)}
                      </time>
                    </div>
                    {n.body && (
                      <p className="mt-0.5 line-clamp-2 text-[11.5px] text-muted-foreground">
                        {n.body}
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        {/* Footer help */}
        <div className="flex h-7 shrink-0 items-center gap-2 border-t border-border px-3 text-[10px] text-muted-foreground">
          <Kbd>j</Kbd>/<Kbd>k</Kbd> nav
          <Kbd>r</Kbd> reply
          <Kbd>m</Kbd> read
          <Kbd>e</Kbd> archive
          <Kbd>↵</Kbd> open
        </div>
      </section>

      {/* Right: detail */}
      <section className="min-w-0 flex-1 overflow-y-auto">
        {!selected && (
          <div className="flex h-full items-center justify-center text-[12px] text-muted-foreground">
            Select a notification to read.
          </div>
        )}
        {selected && (
          <article className="mx-auto flex h-full max-w-2xl flex-col px-8 py-6">
            <header className="border-b border-border pb-4">
              <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                <span>{selected.kind}</span>
                <span>·</span>
                <span>{selected.severity}</span>
                {selected.agentRole && (
                  <>
                    <span>·</span>
                    <span className="font-mono lowercase">@{selected.agentRole}</span>
                  </>
                )}
              </div>
              <h2 className="mt-1.5 text-[18px] font-semibold tracking-tight text-foreground">
                {selected.title}
              </h2>
              <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                <time>{formatTimestamp(selected.createdAt)}</time>
                <span>·</span>
                <span>{formatRelativeTime(selected.createdAt)}</span>
              </div>
            </header>

            <div className="flex-1 space-y-4 py-5">
              {selected.body ? (
                <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-foreground/85">
                  {selected.body}
                </p>
              ) : (
                <p className="text-[12px] italic text-muted-foreground">No body.</p>
              )}

              {selected.taskId && (
                <div className="rounded-lg border border-border bg-card p-3">
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                    Linked task
                  </div>
                  <Link
                    href={`/tasks/${selected.taskId}`}
                    className="font-mono text-[12px] text-primary hover:underline"
                  >
                    {selected.taskId}
                  </Link>
                </div>
              )}
            </div>

            {/* Reply composer */}
            <div className="border-t border-border pt-4">
              <label
                htmlFor="inbox-reply"
                className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground"
              >
                Reply
              </label>
              <textarea
                id="inbox-reply"
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                placeholder="Write a reply…"
                rows={3}
                className="w-full resize-none rounded-md border border-border bg-secondary/30 px-3 py-2 text-[12.5px] text-foreground placeholder:text-muted-foreground focus:bg-background focus:outline-none focus:ring-1 focus:ring-primary/40"
              />
              <div className="mt-2 flex items-center justify-between">
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                  {selected.readAt === null && (
                    <button
                      type="button"
                      onClick={() => handleMarkRead(selected.id)}
                      className="rounded-md border border-border px-2 py-1 transition-colors hover:bg-secondary hover:text-foreground"
                    >
                      Mark read
                    </button>
                  )}
                  {selected.archivedAt === null && (
                    <button
                      type="button"
                      onClick={() => handleArchive(selected.id)}
                      className="rounded-md border border-border px-2 py-1 transition-colors hover:bg-secondary hover:text-foreground"
                    >
                      Archive
                    </button>
                  )}
                </div>
                <button
                  type="button"
                  disabled={!reply.trim()}
                  className="rounded-md bg-primary px-3 py-1.5 text-[11px] font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Send
                </button>
              </div>
            </div>
          </article>
        )}
      </section>
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-border bg-background px-1 font-mono text-[9px]">
      {children}
    </kbd>
  );
}
