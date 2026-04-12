"use client";

import { cn } from "@/lib/utils";

export type InboxFilter = "unread" | "all" | "archive";

interface NotificationFiltersProps {
  value: InboxFilter;
  onChange: (f: InboxFilter) => void;
  counts?: Partial<Record<InboxFilter, number>>;
  className?: string;
}

const FILTERS: Array<{ key: InboxFilter; label: string }> = [
  { key: "unread", label: "Unread" },
  { key: "all", label: "All" },
  { key: "archive", label: "Archive" },
];

export function NotificationFilters({
  value,
  onChange,
  counts,
  className,
}: NotificationFiltersProps) {
  return (
    <div className={cn("flex items-center gap-1", className)}>
      {FILTERS.map((f) => {
        const active = value === f.key;
        const c = counts?.[f.key];
        return (
          <button
            key={f.key}
            type="button"
            onClick={() => onChange(f.key)}
            className={cn(
              "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs transition-colors",
              active
                ? "bg-primary text-primary-foreground"
                : "bg-secondary/60 text-muted-foreground hover:bg-secondary hover:text-foreground",
            )}
          >
            <span>{f.label}</span>
            {typeof c === "number" && (
              <span
                className={cn(
                  "rounded-full px-1.5 font-mono text-[10px]",
                  active
                    ? "bg-primary-foreground/20 text-primary-foreground"
                    : "bg-background/60 text-muted-foreground",
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
