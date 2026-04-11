import type { Task } from "@/lib/types";
import { cn } from "@/lib/utils";

interface TaskCardProps {
  task: Task;
}

const priorityConfig: Record<string, { color: string; label: string }> = {
  urgent: { color: "bg-red-500", label: "Urgent" },
  high: { color: "bg-orange-500", label: "High" },
  medium: { color: "bg-yellow-500", label: "Medium" },
  low: { color: "bg-blue-500", label: "Low" },
  none: { color: "bg-gray-500", label: "None" },
};

const agentAvatarColors: Record<string, string> = {
  engineer: "bg-blue-500/20 text-blue-400",
  strategist: "bg-purple-500/20 text-purple-400",
  ops: "bg-amber-500/20 text-amber-400",
};

function formatDuration(seconds: number | null): string {
  if (seconds === null) return "--";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function TaskCard({ task }: TaskCardProps) {
  const priority = priorityConfig[task.priority] ?? priorityConfig.none;

  return (
    <div className="group rounded-lg border border-border bg-card p-3 transition-colors hover:border-border/80">
      <div className="flex items-start justify-between gap-2">
        <span className="font-mono text-xs text-muted-foreground">
          {task.issueKey}
        </span>
        <div className="flex items-center gap-1.5">
          <span className={cn("size-1.5 rounded-full", priority.color)} />
          <span className="text-xs text-muted-foreground">{priority.label}</span>
        </div>
      </div>

      <h4 className="mt-1.5 text-sm font-medium leading-snug line-clamp-2">
        {task.title}
      </h4>

      <div className="mt-3 flex items-center justify-between">
        {task.agent ? (
          <div
            className={cn(
              "flex size-6 items-center justify-center rounded-md text-xs font-semibold",
              agentAvatarColors[task.agent] ?? "bg-muted text-muted-foreground"
            )}
          >
            {task.agent.charAt(0).toUpperCase()}
          </div>
        ) : (
          <div className="size-6 rounded-md border border-dashed border-border" />
        )}
        <span className="font-mono text-xs text-muted-foreground">
          {formatDuration(task.duration)}
        </span>
      </div>
    </div>
  );
}
