"use client";

import { cn } from "@/lib/utils";

export type InboxFilter =
  | "all"
  | "unread"
  | "mentions"
  | "alerts"
  | "briefings"
  | "archive";

interface NotificationFiltersProps {
  value: InboxFilter;
  onChange: (f: InboxFilter) => void;
  counts?: Partial<Record<InboxFilter, number>>;
  className?: string;
}

const FILTERS: Array<{ key: InboxFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "unread", label: "Unread" },
  { key: "mentions", label: "Mentions" },
  { key: "alerts", label: "Alerts" },
  { key: "briefings", label: "Briefings" },
  { key: "archive", label: "Archive" },
];

export function NotificationFilters({
  value,
  onChange,
  counts,
  className,
}: NotificationFiltersProps) {
  return (
    <div className={cn("flex items-center gap-0.5 overflow-x-auto", className)}>
      {FILTERS.map((f) => {
        const active = value === f.key;
        const c = counts?.[f.key];
        return (
          <button
            key={f.key}
            type="button"
            onClick={() => onChange(f.key)}
            className={cn(
              "flex items-center gap-1 rounded-md px-2 py-1 text-[11px] transition-colors whitespace-nowrap",
              active
                ? "bg-secondary text-foreground font-medium"
                : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
            )}
          >
            <span>{f.label}</span>
            {typeof c === "number" && c > 0 && (
              <span
                className={cn(
                  "rounded px-1 font-mono text-[9px]",
                  active ? "bg-background text-foreground" : "text-muted-foreground/70",
                )}
              >
                {c}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Maps the UI filter to the backend `list` filter param.
 * Backend currently supports: unread | all | archive
 * Mentions/Alerts/Briefings are filtered client-side from "all".
 */
export function backendFilterFor(f: InboxFilter): "unread" | "all" | "archive" {
  if (f === "unread") return "unread";
  if (f === "archive") return "archive";
  return "all";
}
