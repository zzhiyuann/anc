import { cn } from "@/lib/utils";

/**
 * Status values shown in the UI. The backend session states are
 * 'active' | 'idle' | 'suspended'; we also render computed UI states
 * like 'queued', 'completed', 'failed' for tasks and events.
 */
export type UiStatus =
  | "active"
  | "idle"
  | "suspended"
  | "queued"
  | "completed"
  | "failed";

const statusConfig: Record<UiStatus, { color: string; bg: string; label: string }> = {
  active: {
    color: "bg-status-active",
    bg: "bg-status-active/10 text-status-active",
    label: "Active",
  },
  idle: {
    color: "bg-status-idle",
    bg: "bg-status-idle/10 text-status-idle",
    label: "Idle",
  },
  suspended: {
    color: "bg-status-suspended",
    bg: "bg-status-suspended/10 text-status-suspended",
    label: "Suspended",
  },
  queued: {
    color: "bg-status-queued",
    bg: "bg-status-queued/10 text-status-queued",
    label: "Queued",
  },
  completed: {
    color: "bg-status-completed",
    bg: "bg-status-completed/10 text-status-completed",
    label: "Completed",
  },
  failed: {
    color: "bg-status-failed",
    bg: "bg-status-failed/10 text-status-failed",
    label: "Failed",
  },
};

interface StatusBadgeProps {
  status: UiStatus;
  className?: string;
  showDot?: boolean;
}

export function StatusBadge({ status, className, showDot = true }: StatusBadgeProps) {
  const config = statusConfig[status] ?? statusConfig.idle;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium",
        config.bg,
        className,
      )}
    >
      {showDot && (
        <span
          className={cn(
            "size-1.5 rounded-full",
            config.color,
            status === "active" && "animate-pulse",
          )}
        />
      )}
      {config.label}
    </span>
  );
}

export function StatusDot({ status, className }: { status: UiStatus; className?: string }) {
  const config = statusConfig[status] ?? statusConfig.idle;
  return (
    <span
      className={cn(
        "size-2 rounded-full",
        config.color,
        status === "active" && "animate-pulse",
        className,
      )}
    />
  );
}
