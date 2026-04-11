import type { AgentStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

const statusConfig: Record<AgentStatus, { color: string; bg: string; label: string }> = {
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
  queued: {
    color: "bg-status-queued",
    bg: "bg-status-queued/10 text-status-queued",
    label: "Queued",
  },
  failed: {
    color: "bg-status-failed",
    bg: "bg-status-failed/10 text-status-failed",
    label: "Failed",
  },
  completed: {
    color: "bg-status-completed",
    bg: "bg-status-completed/10 text-status-completed",
    label: "Completed",
  },
  suspended: {
    color: "bg-status-suspended",
    bg: "bg-status-suspended/10 text-status-suspended",
    label: "Suspended",
  },
};

interface StatusBadgeProps {
  status: AgentStatus;
  className?: string;
  showDot?: boolean;
}

export function StatusBadge({ status, className, showDot = true }: StatusBadgeProps) {
  const config = statusConfig[status];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium",
        config.bg,
        className
      )}
    >
      {showDot && (
        <span
          className={cn(
            "size-1.5 rounded-full",
            config.color,
            status === "active" && "animate-pulse"
          )}
        />
      )}
      {config.label}
    </span>
  );
}

export function StatusDot({ status, className }: { status: AgentStatus; className?: string }) {
  const config = statusConfig[status];
  return (
    <span
      className={cn(
        "size-2 rounded-full",
        config.color,
        status === "active" && "animate-pulse",
        className
      )}
    />
  );
}
