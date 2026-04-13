import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

interface EmptyStateProps {
  illustration?: "tasks" | "select" | "projects" | "search";
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
  compact?: boolean;
}

/**
 * Geometric SVG illustrations — flat, no ornament. Each occupies 96x96 in
 * the default size so they fit a list/detail empty pane without overpowering it.
 */
function Illustration({ kind }: { kind: NonNullable<EmptyStateProps["illustration"]> }) {
  const stroke = "currentColor";
  switch (kind) {
    case "tasks":
      return (
        <svg
          viewBox="0 0 96 96"
          fill="none"
          className="size-24 text-muted-foreground/30"
        >
          <rect x="14" y="20" width="68" height="14" rx="3" stroke={stroke} strokeWidth="1.5" />
          <rect x="14" y="40" width="68" height="14" rx="3" stroke={stroke} strokeWidth="1.5" />
          <rect x="14" y="60" width="68" height="14" rx="3" stroke={stroke} strokeWidth="1.5" />
          <circle cx="22" cy="27" r="2" fill={stroke} />
          <circle cx="22" cy="47" r="2" fill={stroke} />
          <circle cx="22" cy="67" r="2" fill={stroke} />
        </svg>
      );
    case "select":
      return (
        <svg
          viewBox="0 0 96 96"
          fill="none"
          className="size-24 text-muted-foreground/30"
        >
          <rect x="10" y="14" width="34" height="68" rx="4" stroke={stroke} strokeWidth="1.5" />
          <rect x="52" y="14" width="34" height="68" rx="4" stroke={stroke} strokeWidth="1.5" strokeDasharray="2 3" />
          <path d="M16 26h22M16 34h18M16 42h22M16 50h14" stroke={stroke} strokeWidth="1.5" strokeLinecap="round" />
          <circle cx="69" cy="48" r="6" stroke={stroke} strokeWidth="1.5" />
        </svg>
      );
    case "projects":
      return (
        <svg
          viewBox="0 0 96 96"
          fill="none"
          className="size-24 text-muted-foreground/30"
        >
          <path
            d="M14 30a4 4 0 0 1 4-4h16l6 6h38a4 4 0 0 1 4 4v32a4 4 0 0 1-4 4H18a4 4 0 0 1-4-4V30z"
            stroke={stroke}
            strokeWidth="1.5"
          />
        </svg>
      );
    case "search":
      return (
        <svg
          viewBox="0 0 96 96"
          fill="none"
          className="size-24 text-muted-foreground/30"
        >
          <circle cx="42" cy="42" r="22" stroke={stroke} strokeWidth="1.5" />
          <path d="M58 58l16 16" stroke={stroke} strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      );
  }
}

export function EmptyState({
  illustration = "tasks",
  title,
  description,
  action,
  className,
  compact,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex h-full w-full flex-col items-center justify-center gap-3 p-8 text-center",
        compact && "gap-2 p-4",
        className,
      )}
    >
      {!compact && <Illustration kind={illustration} />}
      <div className="space-y-1">
        <h3 className="text-[13px] font-medium text-foreground">{title}</h3>
        {description && (
          <p className="max-w-xs text-[12px] leading-relaxed text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
