"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { SessionOnTask, Task } from "@/lib/types";
import {
  cn,
  formatRelativeTime,
  priorityColor,
  priorityLabel,
} from "@/lib/utils";
import { ContributorsBar } from "./ContributorsBar";
import { taskStateClass } from "./role-colors";

interface TaskHeaderProps {
  task: Task;
  sessions: SessionOnTask[];
  onDispatch: () => void;
  onKill: () => void;
  onPickContributor?: (role: string) => void;
  killing?: boolean;
}

export function TaskHeader({
  task,
  sessions,
  onDispatch,
  onKill,
  onPickContributor,
  killing,
}: TaskHeaderProps) {
  return (
    <div className="border-b border-border pb-5">
      <div className="mb-3 flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/tasks" className="transition-colors hover:text-foreground">
          Tasks
        </Link>
        <svg
          className="size-3"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M6 4l4 4-4 4" />
        </svg>
        <span className="font-mono text-xs text-foreground">{task.id}</span>
      </div>

      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold leading-tight tracking-tight">
            {task.title}
          </h1>

          <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 font-medium uppercase",
                taskStateClass(task.state),
              )}
            >
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  task.state === "running" && "bg-status-active animate-pulse",
                  task.state === "todo" && "bg-muted-foreground",
                  task.state === "review" && "bg-blue-400",
                  task.state === "done" && "bg-status-completed",
                  task.state === "failed" && "bg-status-failed",
                  task.state === "canceled" && "bg-muted-foreground",
                )}
              />
              {task.state}
            </span>

            <span className="inline-flex items-center gap-1.5">
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  priorityColor(task.priority),
                )}
              />
              <span className="text-muted-foreground">
                {priorityLabel(task.priority)}
              </span>
            </span>

            <span className="text-muted-foreground">
              by{" "}
              <span className="font-mono text-foreground">{task.createdBy}</span>
            </span>
            <span className="text-muted-foreground">
              {formatRelativeTime(task.createdAt)}
            </span>
            {task.linearIssueKey && (
              <span className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                {task.linearIssueKey}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <ContributorsBar sessions={sessions} onPick={onPickContributor} />
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={onDispatch}>
              Dispatch
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={onKill}
              disabled={killing}
              className="text-status-failed hover:text-status-failed"
            >
              {killing ? "Killing..." : "Kill"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
