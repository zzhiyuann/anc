"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { AncNotification } from "@/lib/types";
import { formatRelativeTime } from "@/lib/utils";

export function NeedsInputQueue() {
  const [items, setItems] = useState<AncNotification[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let aborted = false;
    api.notifications
      .list("unread")
      .then((res) => {
        if (aborted) return;
        // Filter to mentions only — these are the agent questions awaiting CEO input.
        setItems(res.notifications.filter((n) => n.kind === "mention"));
      })
      .catch(() => {
        if (!aborted) setItems([]);
      })
      .finally(() => {
        if (!aborted) setLoading(false);
      });
    return () => {
      aborted = true;
    };
  }, []);

  const handleResolve = async (
    id: number,
    action: "reply" | "approve" | "defer",
  ) => {
    if (action === "approve" || action === "defer") {
      setItems((prev) => prev.filter((n) => n.id !== id));
      try {
        await api.notifications.markRead(id);
      } catch {
        // noop
      }
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
            {items.length} agent question{items.length === 1 ? "" : "s"}{" "}
            waiting on you
          </p>
        </div>
      </header>

      <div className="divide-y divide-border/60">
        {loading && (
          <div className="px-4 py-6 text-[13px] text-muted-foreground">
            Loading…
          </div>
        )}
        {!loading && items.length === 0 && (
          <div className="px-4 py-8 text-center">
            <p className="text-[13px] font-medium">All clear</p>
            <p className="text-[11px] text-muted-foreground">
              No agents are blocked on you right now.
            </p>
          </div>
        )}
        {items.map((n) => (
          <article
            key={n.id}
            className="flex items-start gap-3 px-4 py-3 hover:bg-accent/30"
          >
            <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-secondary text-[11px] font-semibold uppercase">
              {(n.agentRole ?? "?").charAt(0)}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="truncate text-[13px] font-medium">
                  {n.title}
                </span>
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
                {n.taskId ? (
                  <Link
                    href={`/tasks/${n.taskId}`}
                    className="rounded-md border border-border bg-secondary/50 px-2 py-0.5 text-[11px] hover:bg-secondary"
                  >
                    Reply
                  </Link>
                ) : (
                  <button
                    onClick={() => handleResolve(n.id, "reply")}
                    className="rounded-md border border-border bg-secondary/50 px-2 py-0.5 text-[11px] hover:bg-secondary"
                  >
                    Reply
                  </button>
                )}
                <button
                  onClick={() => handleResolve(n.id, "approve")}
                  className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-400 hover:bg-emerald-500/20"
                >
                  Approve
                </button>
                <button
                  onClick={() => handleResolve(n.id, "defer")}
                  className="rounded-md border border-border bg-secondary/50 px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-secondary"
                >
                  Defer
                </button>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
