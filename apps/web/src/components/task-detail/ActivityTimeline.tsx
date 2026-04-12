"use client";

import type { TaskEvent } from "@/lib/types";
import { cn, formatRelativeTime } from "@/lib/utils";
import { roleTextClass } from "./role-colors";

interface ActivityTimelineProps {
  events: TaskEvent[];
}

function bucket(ts: number): "today" | "yesterday" | "older" {
  const day = 24 * 60 * 60 * 1000;
  const diff = Date.now() - ts;
  if (diff < day) return "today";
  if (diff < 2 * day) return "yesterday";
  return "older";
}

const BUCKET_LABELS: Record<string, string> = {
  today: "Today",
  yesterday: "Yesterday",
  older: "Earlier",
};

function eventIcon(type: string): string {
  if (type.includes("spawned")) return "▶";
  if (type.includes("completed")) return "✓";
  if (type.includes("failed")) return "✗";
  if (type.includes("idle")) return "⏸";
  if (type.includes("suspended")) return "⏸";
  if (type.includes("dispatched")) return "↗";
  if (type.includes("comment")) return "💬";
  if (type.includes("plan")) return "📋";
  if (type.includes("file")) return "📝";
  if (type.includes("bash")) return "⚡";
  return "•";
}

function describe(e: TaskEvent): string {
  const p = (e.payload as Record<string, unknown> | null) ?? {};
  if (typeof p.preview === "string") return p.preview;
  if (typeof p.detail === "string") return p.detail as string;
  if (typeof p.message === "string") return p.message as string;
  return e.type.replace("agent:", "").replace(/-/g, " ");
}

export function ActivityTimeline({ events }: ActivityTimelineProps) {
  if (events.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
        No activity yet.
      </p>
    );
  }

  // Group by bucket, descending time.
  const sorted = [...events].sort((a, b) => b.createdAt - a.createdAt);
  const groups: Record<string, TaskEvent[]> = {};
  for (const e of sorted) {
    const b = bucket(e.createdAt);
    (groups[b] ??= []).push(e);
  }

  return (
    <div className="space-y-4">
      {(["today", "yesterday", "older"] as const).map((b) => {
        const list = groups[b];
        if (!list || list.length === 0) return null;
        return (
          <div key={b}>
            <h4 className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              {BUCKET_LABELS[b]}
            </h4>
            <ul className="space-y-1.5">
              {list.map((e) => (
                <li
                  key={e.id}
                  className="flex items-start gap-2 text-xs leading-relaxed"
                >
                  <span className="mt-0.5 w-3 text-center text-muted-foreground">
                    {eventIcon(e.type)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      {e.role && (
                        <span
                          className={cn(
                            "font-mono text-[10px] font-semibold uppercase",
                            roleTextClass(e.role),
                          )}
                        >
                          {e.role}
                        </span>
                      )}
                      <span className="text-muted-foreground">
                        {formatRelativeTime(e.createdAt)}
                      </span>
                    </div>
                    <p className="truncate text-foreground/90">{describe(e)}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
