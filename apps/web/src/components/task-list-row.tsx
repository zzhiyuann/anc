"use client";

import { ArrowUp, Equal, ChevronUp, Minus, Crown } from "lucide-react";
import type { ProjectWithStats, Task } from "@/lib/types";
import {
  agentInitial,
  cn,
  formatRelativeTime,
} from "@/lib/utils";

interface TaskListRowProps {
  task: Task;
  /** Optional project metadata for tagging. */
  project?: Pick<ProjectWithStats, "id" | "name" | "color" | "icon"> | null;
  /** Cost in USD, optional. */
  cost?: number;
  /** Active session role, optional. */
  role?: string | null;
  selected?: boolean;
  onSelect?: (id: string, modKey: boolean) => void;
}

const agentColors: Record<string, string> = {
  engineer: "bg-blue-500/15 text-blue-500",
  strategist: "bg-purple-500/15 text-purple-500",
  ops: "bg-amber-500/15 text-amber-600",
};

function PriorityIcon({ priority }: { priority: number }) {
  // 1=CEO, 2=Urgent, 3=Normal, 5=Duty
  if (priority === 1)
    return <Crown className="size-3 text-red-500" aria-label="CEO" />;
  if (priority === 2)
    return <ArrowUp className="size-3 text-orange-500" aria-label="Urgent" />;
  if (priority === 3)
    return <Equal className="size-3 text-yellow-500" aria-label="Normal" />;
  if (priority === 5)
    return <ChevronUp className="size-3 text-blue-500" aria-label="Duty" />;
  return <Minus className="size-3 text-muted-foreground" aria-label={`P${priority}`} />;
}

const stateBadge: Record<Task["state"], { label: string; cls: string }> = {
  todo: { label: "Todo", cls: "bg-muted text-muted-foreground" },
  running: { label: "Running", cls: "bg-status-active/15 text-status-active" },
  review: { label: "Review", cls: "bg-status-queued/15 text-status-queued" },
  done: { label: "Done", cls: "bg-status-completed/15 text-status-completed" },
  failed: { label: "Failed", cls: "bg-status-failed/15 text-status-failed" },
  canceled: { label: "Canceled", cls: "bg-muted text-muted-foreground" },
};

export function TaskListRow({
  task,
  project,
  cost,
  role,
  selected,
  onSelect,
}: TaskListRowProps) {
  const badge = stateBadge[task.state] ?? stateBadge.todo;
  const shortId = task.id.startsWith("task-")
    ? task.id.slice(5, 13)
    : task.id.slice(0, 8);

  return (
    <div
      role="button"
      tabIndex={0}
      data-selected={selected ? "true" : "false"}
      onClick={(e) => onSelect?.(task.id, e.metaKey || e.ctrlKey)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect?.(task.id, e.metaKey || e.ctrlKey);
        }
      }}
      className="linear-row group focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      {/* Priority */}
      <div className="flex w-3 shrink-0 items-center justify-center">
        <PriorityIcon priority={task.priority} />
      </div>

      {/* ID */}
      <span className="w-16 shrink-0 font-mono text-[11px] text-muted-foreground">
        {shortId}
      </span>

      {/* Title */}
      <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">
        {task.title}
        {project && (
          <span
            className="ml-2 inline-flex items-center gap-1 rounded px-1 py-0.5 text-[10px]"
            style={{
              backgroundColor: `${project.color}1a`,
              color: project.color,
            }}
          >
            {project.icon ?? "📁"}
            <span className="max-w-[8rem] truncate">{project.name}</span>
          </span>
        )}
      </span>

      {/* Agent avatar */}
      {role ? (
        <div
          className={cn(
            "flex size-[18px] shrink-0 items-center justify-center rounded text-[10px] font-semibold",
            agentColors[role] ?? "bg-muted text-muted-foreground",
          )}
          title={role}
        >
          {agentInitial(role)}
        </div>
      ) : (
        <div className="size-[18px] shrink-0 rounded border border-dashed border-border" />
      )}

      {/* State */}
      <span
        className={cn(
          "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium",
          badge.cls,
        )}
      >
        {badge.label}
      </span>

      {/* Cost */}
      <span className="w-12 shrink-0 text-right font-mono text-[11px] text-muted-foreground tabular-nums">
        {cost != null && cost > 0 ? `$${cost.toFixed(2)}` : "—"}
      </span>

      {/* Time */}
      <span className="w-16 shrink-0 text-right text-[11px] text-muted-foreground">
        {formatRelativeTime(task.createdAt)}
      </span>
    </div>
  );
}
