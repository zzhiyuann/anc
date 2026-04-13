"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { Task } from "@/lib/types";
import { formatRelativeTime } from "@/lib/utils";

const SEVEN_DAYS_MS = 7 * 24 * 3600 * 1000;

export function WinsFeed() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let aborted = false;
    api.tasks
      .list({ status: "done" })
      .then((rows) => {
        if (aborted) return;
        setTasks(rows);
      })
      .catch(() => {
        if (!aborted) setTasks([]);
      })
      .finally(() => {
        if (!aborted) setLoading(false);
      });
    return () => {
      aborted = true;
    };
  }, []);

  const recent = useMemo(() => {
    const cutoff = Date.now() - SEVEN_DAYS_MS;
    return tasks
      .filter((t) => (t.completedAt ?? 0) > cutoff)
      .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0))
      .slice(0, 25);
  }, [tasks]);

  const copyOne = async (t: Task) => {
    const md = `- [${t.title}](${t.id}) — shipped ${formatRelativeTime(t.completedAt ?? Date.now())}`;
    try {
      await navigator.clipboard.writeText(md);
      toast.success("Copied win to clipboard");
    } catch {
      toast.error("Clipboard not available");
    }
  };

  const copyAll = async () => {
    const md = recent
      .map(
        (t) =>
          `- ${t.title} — shipped ${formatRelativeTime(t.completedAt ?? Date.now())}`,
      )
      .join("\n");
    try {
      await navigator.clipboard.writeText(md || "(no wins yet)");
      toast.success(`Copied ${recent.length} wins`);
    } catch {
      toast.error("Clipboard not available");
    }
  };

  return (
    <section className="rounded-xl border border-border bg-card">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <div>
          <h2 className="text-[14px] font-semibold tracking-tight">
            Wins this week
          </h2>
          <p className="text-[11px] text-muted-foreground">
            {recent.length} task{recent.length === 1 ? "" : "s"} shipped in the
            last 7 days
          </p>
        </div>
        <button
          onClick={copyAll}
          className="rounded-md border border-border bg-secondary/50 px-2.5 py-1 text-[11px] text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          Copy all
        </button>
      </header>

      <div className="divide-y divide-border/60">
        {loading && (
          <div className="px-4 py-6 text-[13px] text-muted-foreground">
            Loading…
          </div>
        )}
        {!loading && recent.length === 0 && (
          <div className="px-4 py-8 text-center">
            <p className="text-[13px] font-medium">Nothing shipped yet</p>
            <p className="text-[11px] text-muted-foreground">
              Wins from the last 7 days will land here.
            </p>
          </div>
        )}
        {recent.map((t) => (
          <article
            key={t.id}
            className="group flex items-center gap-3 px-4 py-2.5 hover:bg-accent/30"
          >
            <span className="text-emerald-500">✓</span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium">{t.title}</p>
              <p className="text-[11px] text-muted-foreground">
                {formatRelativeTime(t.completedAt ?? Date.now())}
                {t.assignee ? ` · @${t.assignee}` : ""}
              </p>
            </div>
            <button
              onClick={() => copyOne(t)}
              className="rounded-md border border-border bg-secondary/40 px-2 py-0.5 text-[10px] text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground"
            >
              Copy
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}
