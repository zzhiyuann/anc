"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import type { Task } from "@/lib/types";
import { formatRelativeTime } from "@/lib/utils";

interface SlowTask {
  task: Task;
  ageMs: number;
  medianMs: number;
}

export function SlowTasksCard() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let aborted = false;
    api.tasks
      .list({})
      .then((rows) => {
        if (!aborted) setTasks(rows);
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

  const slow = useMemo<SlowTask[]>(() => {
    const completed = tasks.filter(
      (t) => t.completedAt !== null && t.createdAt > 0,
    );
    // Median completion duration per (assignee, source) bucket as a rough proxy.
    const buckets = new Map<string, number[]>();
    for (const t of completed) {
      const key = `${t.assignee ?? "?"}::${t.source}`;
      const dur = (t.completedAt ?? 0) - t.createdAt;
      if (dur > 0) {
        const list = buckets.get(key) ?? [];
        list.push(dur);
        buckets.set(key, list);
      }
    }
    const medians = new Map<string, number>();
    for (const [k, list] of buckets) {
      list.sort((a, b) => a - b);
      medians.set(k, list[Math.floor(list.length / 2)]);
    }

    const now = Date.now();
    const running = tasks.filter((t) => t.state === "running");
    const flagged: SlowTask[] = [];
    for (const t of running) {
      const key = `${t.assignee ?? "?"}::${t.source}`;
      const median = medians.get(key);
      if (!median) continue;
      const age = now - t.createdAt;
      if (age > 2 * median) {
        flagged.push({ task: t, ageMs: age, medianMs: median });
      }
    }
    return flagged;
  }, [tasks]);

  return (
    <section className="rounded-xl border border-border bg-card">
      <header className="border-b border-border px-4 py-3">
        <h2 className="text-[14px] font-semibold tracking-tight">
          Slow tasks
        </h2>
        <p className="text-[11px] text-muted-foreground">
          Running &gt; 2x median for their bucket
        </p>
      </header>

      <div className="px-4 py-4">
        {loading && (
          <p className="text-[13px] text-muted-foreground">Scanning…</p>
        )}
        {!loading && slow.length === 0 && (
          <p className="text-[13px] text-muted-foreground">
            No anomalies detected
          </p>
        )}
        {!loading && slow.length > 0 && (
          <ul className="space-y-2">
            {slow.map((s) => (
              <li key={s.task.id}>
                <Link
                  href={`/tasks/${s.task.id}`}
                  className="block rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 transition-colors hover:bg-amber-500/10"
                >
                  <p className="text-[13px] font-medium">{s.task.title}</p>
                  <p className="text-[11px] text-muted-foreground">
                    Running for {formatRelativeTime(s.task.createdAt)} · median
                    is {Math.round(s.medianMs / 60000)}m
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
