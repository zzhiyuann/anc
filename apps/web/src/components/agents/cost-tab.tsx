"use client";

/**
 * CostTab — current spend snapshot for a single agent role.
 *
 * Backend reality:
 *   - `GET /api/v1/config/budget` exposes `summary.perAgent[role].spent`
 *     (today's USD spend) + `.limit`. That's the only per-role cost surface
 *     today.
 *   - There is NO endpoint for daily breakdown / 14-day series / monthly
 *     totals. budget_log is only surfaced through the per-task aggregate
 *     in /tasks/:id, never by role + day. Documented as a backend gap; the
 *     14-day sparkline stays hidden until a /budget/series endpoint lands.
 */

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { api } from "@/lib/api";

interface CostTabProps {
  role: string;
}

interface RoleCostSummary {
  spent: number;
  limit: number;
}

export function CostTab({ role }: CostTabProps) {
  const [summary, setSummary] = useState<RoleCostSummary | null>(null);
  const [dailyTotal, setDailyTotal] = useState<{
    spent: number;
    limit: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const cfg = await api.config.getBudget();
        if (cancelled) return;
        const per = cfg.summary.perAgent?.[role];
        setSummary(per ? { spent: per.spent, limit: per.limit } : null);
        setDailyTotal({
          spent: cfg.summary.today.spent,
          limit: cfg.summary.today.limit,
        });
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [role]);

  if (loading) {
    return (
      <div className="flex h-32 items-center justify-center text-[13px] text-muted-foreground">
        <Loader2 className="mr-2 size-4 animate-spin" />
        Loading cost…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-[12px] text-amber-300">
        Failed to load cost: {error}
      </div>
    );
  }

  const spent = summary?.spent ?? 0;
  const limit = summary?.limit ?? 0;
  const pct = limit > 0 ? Math.min(100, (spent / limit) * 100) : 0;

  return (
    <div className="space-y-4">
      {/* Today card */}
      <div className="rounded-lg border border-border bg-card p-5">
        <div className="flex items-baseline justify-between">
          <div>
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Today
            </div>
            <div className="mt-1 font-mono text-2xl font-semibold">
              ${spent.toFixed(2)}
            </div>
          </div>
          <div className="text-right text-[11px] text-muted-foreground">
            <div>Limit: ${limit.toFixed(2)}</div>
            <div>{pct.toFixed(0)}% used</div>
          </div>
        </div>
        {limit > 0 && (
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-secondary/60">
            <div
              className="h-full rounded-full bg-foreground/80 transition-[width]"
              style={{ width: `${pct}%` }}
            />
          </div>
        )}
      </div>

      {dailyTotal && (
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Company total today
          </div>
          <div className="mt-1 font-mono text-base">
            ${dailyTotal.spent.toFixed(2)}{" "}
            <span className="text-[12px] text-muted-foreground">
              / ${dailyTotal.limit.toFixed(2)}
            </span>
          </div>
        </div>
      )}

      {/* Backend gap notice */}
      <div className="rounded-lg border border-dashed border-border p-4 text-[12px] text-muted-foreground">
        <div className="mb-1 font-medium text-foreground/80">
          14-day sparkline & daily breakdown
        </div>
        Not wired yet — backend has no per-role / per-day budget series
        endpoint. Today&apos;s totals come from{" "}
        <span className="font-mono">/api/v1/config/budget</span>.
      </div>
    </div>
  );
}
