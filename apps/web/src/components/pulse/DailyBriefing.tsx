"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { DailyBriefing as DailyBriefingType } from "@/lib/types";
import { fetchBriefing, PulseError } from "@/components/pulse/pulse-client";
import { api } from "@/lib/api";
import type { Task } from "@/lib/types";
import { formatTimestamp, formatRelativeTime } from "@/lib/utils";

interface DailyBriefingProps {
  /** Bumped by parent when WS hints the briefing is stale. */
  refreshTick?: number;
}

export function DailyBriefing({ refreshTick = 0 }: DailyBriefingProps) {
  const [data, setData] = useState<DailyBriefingType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Map of task title -> task id, so wins/completions can deep-link.
  const [titleIndex, setTitleIndex] = useState<Map<string, string>>(new Map());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchBriefing();
      setData(res);
    } catch (err) {
      setData(null);
      setError(
        err instanceof PulseError
          ? `Failed to load briefing — ${err.message}`
          : "Failed to load briefing",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshTick]);

  // Build a title -> taskId index from the recent task list so the
  // briefing's plain-text wins/completions can be linked back to /tasks/:id.
  useEffect(() => {
    let aborted = false;
    void api.tasks
      .list({})
      .then((rows: Task[]) => {
        if (aborted) return;
        const m = new Map<string, string>();
        for (const t of rows) m.set(t.title, t.id);
        setTitleIndex(m);
      })
      .catch(() => {
        /* leave empty */
      });
    return () => {
      aborted = true;
    };
  }, [refreshTick]);

  const burnPct = data
    ? Math.min(100, (data.costBurn.spentUsd / data.costBurn.budgetUsd) * 100)
    : 0;

  // The backend caches briefings for 1h. Surface that to the user.
  const cacheAgeLabel = useMemo(() => {
    if (!data) return null;
    const ageMs = Date.now() - data.generatedAt;
    if (ageMs < 60_000) return "just now";
    return formatRelativeTime(data.generatedAt);
  }, [data]);

  const stale = data ? Date.now() - data.generatedAt > 5 * 60_000 : false;

  return (
    <section className="rounded-xl border border-border bg-card">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <div>
          <h2 className="text-[14px] font-semibold tracking-tight">
            Today&apos;s briefing
          </h2>
          <p className="text-[11px] text-muted-foreground">
            {data
              ? `Generated ${formatTimestamp(data.generatedAt)}${stale ? " · cached" : ""}`
              : "—"}
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="rounded-md border border-border bg-secondary/50 px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-50"
        >
          {loading ? "Refreshing…" : cacheAgeLabel ? `Refresh · ${cacheAgeLabel}` : "Refresh"}
        </button>
      </header>

      {error && (
        <div className="flex items-center justify-between gap-3 border-b border-amber-500/30 bg-amber-500/5 px-4 py-2 text-[12px] text-amber-300">
          <span>{error}</span>
          <button
            onClick={load}
            className="rounded-md border border-amber-500/40 px-2 py-0.5 text-[11px] hover:bg-amber-500/10"
          >
            Retry
          </button>
        </div>
      )}

      {!data && !error && (
        <div className="px-4 py-6 text-[13px] text-muted-foreground">
          {loading ? "Loading…" : "No briefing available."}
        </div>
      )}

      {data && (
        <div className="grid grid-cols-1 gap-4 px-4 py-4 lg:grid-cols-2">
          <Block label="Yesterday shipped">
            <LinkedList
              items={data.yesterdayCompletions}
              titleIndex={titleIndex}
              icon="✓"
              iconClass="text-emerald-500"
            />
          </Block>

          <Block label="Today's queue">
            <NumberedList items={data.todayQueue} />
          </Block>

          <Block label="Cost burn">
            <div className="space-y-1.5">
              <div className="flex items-baseline justify-between text-[13px]">
                <span className="font-mono">
                  ${data.costBurn.spentUsd.toFixed(2)}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  of ${data.costBurn.budgetUsd.toFixed(2)} budget
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
                <div
                  className={`h-full ${burnPct > 90 ? "bg-red-500" : burnPct > 70 ? "bg-amber-500" : "bg-primary"}`}
                  style={{ width: `${burnPct}%` }}
                />
              </div>
              <p className="text-[11px] text-muted-foreground">
                {burnPct.toFixed(0)}% spent
              </p>
            </div>
          </Block>

          <Block label="Wins">
            <LinkedList
              items={data.wins}
              titleIndex={titleIndex}
              icon="↑"
              iconClass="text-emerald-500"
            />
          </Block>

          {data.risks.length > 0 && (
            <Block label="Risks">
              <ul className="space-y-1.5">
                {data.risks.map((r, i) => (
                  <li key={i} className="flex gap-2 text-[12px] text-foreground">
                    <span className="text-amber-500">⚠</span>
                    <span>{r}</span>
                  </li>
                ))}
              </ul>
            </Block>
          )}
        </div>
      )}
    </section>
  );
}

function Block({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      {children}
    </div>
  );
}

function LinkedList({
  items,
  titleIndex,
  icon,
  iconClass,
}: {
  items: string[];
  titleIndex: Map<string, string>;
  icon: string;
  iconClass: string;
}) {
  if (items.length === 0) {
    return <p className="text-[12px] text-muted-foreground">Nothing to report</p>;
  }
  return (
    <ul className="space-y-1.5">
      {items.slice(0, 5).map((c, i) => {
        // Briefing wins are formatted as "title — handoff_summary".
        const baseTitle = c.split(" — ")[0];
        const taskId = titleIndex.get(baseTitle);
        const inner = (
          <>
            <span className={iconClass}>{icon}</span>
            <span>{c}</span>
          </>
        );
        return (
          <li key={i} className="flex gap-2 text-[13px] text-foreground">
            {taskId ? (
              <Link
                href={`/tasks/${taskId}`}
                className="flex gap-2 hover:text-foreground hover:underline"
              >
                {inner}
              </Link>
            ) : (
              inner
            )}
          </li>
        );
      })}
    </ul>
  );
}

function NumberedList({ items }: { items: string[] }) {
  if (items.length === 0) {
    return <p className="text-[12px] text-muted-foreground">Nothing to report</p>;
  }
  return (
    <ol className="space-y-1.5">
      {items.slice(0, 5).map((t, i) => (
        <li key={i} className="flex gap-2 text-[13px] text-foreground">
          <span className="font-mono text-[11px] text-muted-foreground">
            {i + 1}.
          </span>
          <span>{t}</span>
        </li>
      ))}
    </ol>
  );
}
