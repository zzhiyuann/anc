import type { TaskRow } from "@/lib/types";
import {
  agentInitial,
  cn,
  formatDurationMs,
  priorityColor,
  priorityLabel,
} from "@/lib/utils";

interface TaskCardProps {
  task: TaskRow;
}

const agentAvatarColors: Record<string, string> = {
  engineer: "bg-blue-500/20 text-blue-400",
  strategist: "bg-purple-500/20 text-purple-400",
  ops: "bg-amber-500/20 text-amber-400",
};

export function TaskCard({ task }: TaskCardProps) {
  return (
    <div className="group rounded-lg border border-border bg-card p-3 transition-colors hover:border-border/80">
      <div className="flex items-start justify-between gap-2">
        <span className="font-mono text-xs text-muted-foreground">
          {task.issueKey}
        </span>
        <div className="flex items-center gap-1.5">
          <span className={cn("size-1.5 rounded-full", priorityColor(task.priority))} />
          <span className="text-xs text-muted-foreground">
            {priorityLabel(task.priority)}
          </span>
        </div>
      </div>

      <h4 className="mt-1.5 text-sm font-medium leading-snug line-clamp-2">
        {task.issueKey}
        {task.ceoAssigned && (
          <span className="ml-1.5 rounded bg-red-500/10 px-1 py-0.5 text-[10px] uppercase text-red-400">
            CEO
          </span>
        )}
        {task.isDuty && (
          <span className="ml-1.5 rounded bg-blue-500/10 px-1 py-0.5 text-[10px] uppercase text-blue-400">
            Duty
          </span>
        )}
      </h4>

      <div className="mt-3 flex items-center justify-between">
        {task.role ? (
          <div
            className={cn(
              "flex size-6 items-center justify-center rounded-md text-xs font-semibold",
              agentAvatarColors[task.role] ?? "bg-muted text-muted-foreground",
            )}
          >
            {agentInitial(task.role)}
          </div>
        ) : (
          <div className="size-6 rounded-md border border-dashed border-border" />
        )}
        <span className="font-mono text-xs text-muted-foreground">
          {formatDurationMs(task.spawnedAt)}
        </span>
      </div>
    </div>
  );
}
