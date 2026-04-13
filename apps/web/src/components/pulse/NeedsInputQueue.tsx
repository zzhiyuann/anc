"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { AncNotification } from "@/lib/types";
import { formatRelativeTime } from "@/lib/utils";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

interface NeedsInputQueueProps {
  refreshTick?: number;
}

export function NeedsInputQueue({ refreshTick = 0 }: NeedsInputQueueProps) {
  const [items, setItems] = useState<AncNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openReply, setOpenReply] = useState<number | null>(null);
  const [replyDraft, setReplyDraft] = useState<string>("");
  const [submitting, setSubmitting] = useState<number | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.notifications.list("unread");
      setItems(res.notifications.filter((n) => n.kind === "mention"));
    } catch (err) {
      setItems([]);
      setError(
        err instanceof Error
          ? `Failed to load notifications — ${err.message}`
          : "Failed to load notifications",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload, refreshTick]);

  const removeLocal = (id: number) =>
    setItems((prev) => prev.filter((n) => n.id !== id));

  const handleApprove = async (n: AncNotification) => {
    setSubmitting(n.id);
    try {
      if (n.taskId) {
        await api.taskComments.create(n.taskId, "Approved.", { mentions: [] });
      }
      await api.notifications.markRead(n.id);
      removeLocal(n.id);
      toast.success("Approved");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not approve",
      );
    } finally {
      setSubmitting(null);
    }
  };

  const handleDefer = async (n: AncNotification) => {
    setSubmitting(n.id);
    try {
      await api.notifications.markRead(n.id);
      removeLocal(n.id);
      toast.success("Deferred");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not defer",
      );
    } finally {
      setSubmitting(null);
    }
  };

  const handleReplySubmit = async (n: AncNotification) => {
    if (!replyDraft.trim()) return;
    if (!n.taskId) {
      toast.error("This mention has no linked task");
      return;
    }
    setSubmitting(n.id);
    try {
      await api.taskComments.create(n.taskId, replyDraft.trim(), {
        mentions: n.agentRole ? [n.agentRole] : [],
      });
      await api.notifications.markRead(n.id);
      removeLocal(n.id);
      setOpenReply(null);
      setReplyDraft("");
      toast.success("Reply posted");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not post reply",
      );
    } finally {
      setSubmitting(null);
    }
  };

  return (
    <section className="rounded-xl border border-border bg-card">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <div>
          <h2 className="text-[14px] font-semibold tracking-tight">
            Needs your input
          </h2>
          <p className="text-[11px] text-muted-foreground">
            {items.length} agent question{items.length === 1 ? "" : "s"} waiting
            on you
          </p>
        </div>
      </header>

      {error && (
        <div className="flex items-center justify-between gap-3 border-b border-amber-500/30 bg-amber-500/5 px-4 py-2 text-[12px] text-amber-300">
          <span>{error}</span>
          <button
            onClick={reload}
            className="rounded-md border border-amber-500/40 px-2 py-0.5 text-[11px] hover:bg-amber-500/10"
          >
            Retry
          </button>
        </div>
      )}

      <div className="divide-y divide-border/60">
        {loading && (
          <div className="px-4 py-6 text-[13px] text-muted-foreground">
            Loading…
          </div>
        )}
        {!loading && !error && items.length === 0 && (
          <div className="px-4 py-8 text-center">
            <p className="text-[13px] font-medium">All clear</p>
            <p className="text-[11px] text-muted-foreground">
              No agents are blocked on you right now.
            </p>
          </div>
        )}
        {items.map((n) => {
          const busy = submitting === n.id;
          const replyOpen = openReply === n.id;
          return (
            <article
              key={n.id}
              className="flex items-start gap-3 px-4 py-3 hover:bg-accent/30"
            >
              <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-secondary text-[11px] font-semibold uppercase">
                {(n.agentRole ?? "?").charAt(0)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  {n.taskId ? (
                    <Link
                      href={`/tasks/${n.taskId}`}
                      className="truncate text-[13px] font-medium hover:underline"
                    >
                      {n.title}
                    </Link>
                  ) : (
                    <span className="truncate text-[13px] font-medium">
                      {n.title}
                    </span>
                  )}
                  <span className="flex-shrink-0 text-[11px] text-muted-foreground">
                    {formatRelativeTime(n.createdAt)}
                  </span>
                </div>
                {n.body && (
                  <p className="mt-0.5 line-clamp-2 text-[12px] text-muted-foreground">
                    {n.body}
                  </p>
                )}
                <div className="mt-2 flex items-center gap-1.5">
                  <button
                    onClick={() => {
                      setOpenReply(replyOpen ? null : n.id);
                      setReplyDraft("");
                    }}
                    disabled={busy || !n.taskId}
                    className="rounded-md border border-border bg-secondary/50 px-2 py-0.5 text-[11px] hover:bg-secondary disabled:opacity-50"
                  >
                    {replyOpen ? "Close" : "Reply"}
                  </button>
                  <button
                    onClick={() => handleApprove(n)}
                    disabled={busy}
                    className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-400 hover:bg-emerald-500/20 disabled:opacity-50"
                  >
                    Approve
                  </button>
                  <button
                    onClick={() => handleDefer(n)}
                    disabled={busy}
                    className="rounded-md border border-border bg-secondary/50 px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-secondary disabled:opacity-50"
                  >
                    Defer
                  </button>
                </div>

                {replyOpen && n.taskId && (
                  <div className="mt-2 space-y-1.5">
                    <Textarea
                      placeholder={`Reply to @${n.agentRole ?? "agent"}…`}
                      value={replyDraft}
                      onChange={(e) => setReplyDraft(e.target.value)}
                      rows={3}
                      className="text-[12px]"
                      autoFocus
                    />
                    <div className="flex justify-end gap-1.5">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 px-2 text-[11px]"
                        onClick={() => setOpenReply(null)}
                      >
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        className="h-6 px-2 text-[11px]"
                        onClick={() => handleReplySubmit(n)}
                        disabled={busy || !replyDraft.trim()}
                      >
                        {busy ? "Posting…" : "Send"}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
