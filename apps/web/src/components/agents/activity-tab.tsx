"use client";

/**
 * ActivityTab — last 50 events attributed to this role.
 *
 * Backend reality: `GET /api/v1/events?limit=N` does not accept a `role`
 * filter, so we fetch a larger window and filter client-side. Documented as
 * a backend gap.
 */

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import type { EventRow } from "@/lib/types";
import { formatRelativeTime, parseEventTimestamp } from "@/lib/utils";

interface ActivityTabProps {
  role: string;
}

const SHOW_LIMIT = 50;
const FETCH_WINDOW = 500;

export function ActivityTab({ role }: ActivityTabProps) {
  const [events, setEvents] = useState<EventRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const all = await api.events.list(FETCH_WINDOW);
        if (cancelled) return;
        const filtered = all
          .filter((e) => e.role === role)
          .slice(0, SHOW_LIMIT);
        setEvents(filtered);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [role]);

  if (error) {
    return (
      <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-[12px] text-amber-300">
        Failed to load events: {error}
      </div>
    );
  }
  if (events == null) {
    return (
      <div className="flex h-32 items-center justify-center text-[13px] text-muted-foreground">
        <Loader2 className="mr-2 size-4 animate-spin" />
        Loading activity…
      </div>
    );
  }
  if (events.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-10 text-center">
        <p className="text-sm text-muted-foreground">
          Quiet agent · no recent activity.
        </p>
      </div>
    );
  }

  return (
    <ol className="space-y-2">
      {events.map((e) => {
        const tsMs = parseEventTimestamp(e.createdAt);
        return (
          <li
            key={e.id}
            className="flex items-start gap-3 rounded-lg border border-border bg-card px-4 py-2.5"
          >
            <span
              className={`mt-1.5 size-1.5 shrink-0 rounded-full ${dotFor(e.eventType)}`}
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-mono text-[12px] text-foreground/90">
                  {e.eventType}
                </span>
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  {formatRelativeTime(tsMs)}
                </span>
              </div>
              {(e.issueKey || e.detail) && (
                <div className="mt-0.5 truncate text-[12px] text-muted-foreground">
                  {e.issueKey && (
                    <span className="font-mono text-foreground/70">
                      {e.issueKey}
                    </span>
                  )}
                  {e.issueKey && e.detail && " · "}
                  {e.detail}
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function dotFor(eventType: string): string {
  if (eventType.includes("completed")) return "bg-status-active";
  if (eventType.includes("failed")) return "bg-status-failed";
  if (eventType.includes("suspended")) return "bg-status-idle";
  if (eventType.includes("spawned")) return "bg-blue-500";
  return "bg-muted-foreground/60";
}
