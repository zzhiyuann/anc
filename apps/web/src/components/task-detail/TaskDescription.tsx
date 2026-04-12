"use client";

import type { Task } from "@/lib/types";

interface TaskDescriptionProps {
  task: Task;
}

export function TaskDescription({ task }: TaskDescriptionProps) {
  if (!task.description) return null;
  return (
    <div className="rounded-lg border border-border bg-card/50 p-4">
      <h3 className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        Description
      </h3>
      <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
        {task.description}
      </p>
    </div>
  );
}
