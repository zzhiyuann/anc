"use client";

/**
 * CostTab — current spend snapshot + 14-day sparkline for a single agent role.
 *
 * Endpoints:
 *   - GET /api/v1/config/budget        → today's spend + limit
 *   - GET /api/v1/config/budget/series  → daily cost array
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

interface DayEntry {
  date: string;
  usd: number;
  tokens: number;
}

export function CostTab({ role }: CostTabProps) {
  const [summary, setSummary] = useState<RoleCostSummary | null>(null);
  const [dailyTotal, setDailyTotal] = useState<{
    spent: number;
    limit: number;
  } | null>(null);
  const [series, setSeries] = useState<DayEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [cfg, seriesRes] = await Promise.all([
          api.config.getBudget(),
          api.config.budgetSeries(role, 14).catch(() => null),
        ]);
        if (cancelled) return;
        const per = cfg.summary.perAgent?.[role];
        setSummary(per ? { spent: per.spent, limit: per.limit } : null);
        setDailyTotal({
          spent: cfg.summary.today.spent,
          limit: cfg.summary.today.limit,
        });
        if (seriesRes) {
          setSeries(seriesRes.days);
        }
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
        Loading cost...
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

      {/* 14-day sparkline */}
      {series && series.length > 0 && (
        <div className="rounded-lg border border-border bg-card p-5">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
            14-day cost trend
          </div>
          <div className="mt-3">
            <Sparkline data={series.map((d) => d.usd)} />
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
            <span>{series[0]?.date}</span>
            <span>Total: ${series.reduce((s, d) => s + d.usd, 0).toFixed(2)}</span>
            <span>{series[series.length - 1]?.date}</span>
          </div>

          {/* Daily breakdown table */}
          <div className="mt-4">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-border text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                  <th className="pb-1.5 font-medium">Date</th>
                  <th className="pb-1.5 text-right font-medium">USD</th>
                  <th className="pb-1.5 text-right font-medium">Tokens</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {series.map((day) => (
                  <tr key={day.date} className="text-foreground/90">
                    <td className="py-1.5 font-mono">{day.date}</td>
                    <td className="py-1.5 text-right font-mono">
                      ${day.usd.toFixed(2)}
                    </td>
                    <td className="py-1.5 text-right font-mono text-muted-foreground">
                      {day.tokens.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Inline SVG sparkline — simple polyline.
 */
function Sparkline({ data }: { data: number[] }) {
  const width = 400;
  const height = 48;
  const padding = 2;

  const max = Math.max(...data, 0.001);
  const points = data
    .map((v, i) => {
      const x = padding + (i / Math.max(data.length - 1, 1)) * (width - 2 * padding);
      const y = height - padding - (v / max) * (height - 2 * padding);
      return `${x},${y}`;
    })
    .join(" ");

  // Build the fill area (area under the line).
  const firstX = padding;
  const lastX = padding + ((data.length - 1) / Math.max(data.length - 1, 1)) * (width - 2 * padding);
  const fillPoints = `${firstX},${height - padding} ${points} ${lastX},${height - padding}`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full"
      preserveAspectRatio="none"
      style={{ height: 48 }}
    >
      <polygon
        points={fillPoints}
        className="fill-primary/10"
      />
      <polyline
        points={points}
        fill="none"
        className="stroke-primary"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
