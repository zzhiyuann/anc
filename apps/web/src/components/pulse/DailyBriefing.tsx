"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { DailyBriefing as DailyBriefingType } from "@/lib/types";
import { formatTimestamp } from "@/lib/utils";

export function DailyBriefing() {
  const [data, setData] = useState<DailyBriefingType | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.pulse.briefing();
      setData(res);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const burnPct = data
    ? Math.min(100, (data.costBurn.spentUsd / data.costBurn.budgetUsd) * 100)
    : 0;

  return (
    <section className="rounded-xl border border-border bg-card">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <div>
          <h2 className="text-[14px] font-semibold tracking-tight">
            Today&apos;s briefing
          </h2>
          <p className="text-[11px] text-muted-foreground">
            {data ? formatTimestamp(data.generatedAt) : "8:00 AM"}
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="rounded-md border border-border bg-secondary/50 px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-50"
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </header>

      {!data && (
        <div className="px-4 py-6 text-[13px] text-muted-foreground">
          No briefing available.
        </div>
      )}

      {data && (
        <div className="grid grid-cols-1 gap-4 px-4 py-4 lg:grid-cols-2">
          <Block label="Yesterday shipped">
            {data.yesterdayCompletions.length === 0 ? (
              <p className="text-[12px] text-muted-foreground">
                No completions logged.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {data.yesterdayCompletions.slice(0, 3).map((c, i) => (
                  <li
                    key={i}
                    className="flex gap-2 text-[13px] text-foreground"
                  >
                    <span className="text-[var(--color-status-done,#22c55e)]">
                      ✓
                    </span>
                    <span>{c}</span>
                  </li>
                ))}
              </ul>
            )}
          </Block>

          <Block label="Today's queue">
            <ol className="space-y-1.5">
              {data.todayQueue.slice(0, 5).map((t, i) => (
                <li
                  key={i}
                  className="flex gap-2 text-[13px] text-foreground"
                >
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {i + 1}.
                  </span>
                  <span>{t}</span>
                </li>
              ))}
            </ol>
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
                  className="h-full bg-primary"
                  style={{ width: `${burnPct}%` }}
                />
              </div>
              <p className="text-[11px] text-muted-foreground">
                {burnPct.toFixed(0)}% spent
              </p>
            </div>
          </Block>

          <Block label="Wins & risks">
            <div className="space-y-1.5">
              {data.wins.map((w, i) => (
                <div
                  key={`w-${i}`}
                  className="text-[12px] text-foreground"
                >
                  <span className="text-emerald-500">↑ </span>
                  {w}
                </div>
              ))}
              {data.risks.map((r, i) => (
                <div
                  key={`r-${i}`}
                  className="text-[12px] text-foreground"
                >
                  <span className="text-amber-500">⚠ </span>
                  {r}
                </div>
              ))}
            </div>
          </Block>
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
