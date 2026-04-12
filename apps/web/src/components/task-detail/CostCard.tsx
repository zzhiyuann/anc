"use client";

import type { TaskCost } from "@/lib/types";
import { agentInitial, cn } from "@/lib/utils";
import { roleAvatarClass, roleTextClass } from "./role-colors";

interface CostCardProps {
  cost: TaskCost;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return `${n}`;
}

export function CostCard({ cost }: CostCardProps) {
  const total = cost.totalUsd ?? 0;
  const sorted = [...cost.byAgent].sort((a, b) => b.usd - a.usd);
  const max = sorted[0]?.usd ?? 0;

  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex items-baseline justify-between">
        <h3 className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Cost
        </h3>
        <span className="font-mono text-2xl font-semibold tabular-nums">
          ${total.toFixed(2)}
        </span>
      </div>

      {sorted.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">No spend yet.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {sorted.map((row) => {
            const pct = max > 0 ? (row.usd / max) * 100 : 0;
            return (
              <li key={row.role} className="space-y-1">
                <div className="flex items-center gap-2 text-xs">
                  <span
                    className={cn(
                      "flex size-5 items-center justify-center rounded-full text-[10px] font-semibold",
                      roleAvatarClass(row.role),
                    )}
                  >
                    {agentInitial(row.role)}
                  </span>
                  <span
                    className={cn(
                      "font-medium capitalize",
                      roleTextClass(row.role),
                    )}
                  >
                    {row.role}
                  </span>
                  <span className="ml-auto font-mono tabular-nums">
                    ${row.usd.toFixed(2)}
                  </span>
                  <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
                    {formatTokens(row.tokens)}
                  </span>
                </div>
                <div className="h-1 overflow-hidden rounded-full bg-secondary">
                  <div
                    className="h-full rounded-full bg-blue-500/60"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
