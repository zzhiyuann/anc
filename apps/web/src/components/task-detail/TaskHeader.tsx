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
import { roleAvatarClass } from "./role-colors";
import { agentInitial } from "@/lib/utils";

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
  // Contributors: dedupe sessions by role; if empty AND assignee set, show
  // synthetic assignee chip so the strip is never empty when there's an owner.
  const sessionRoles = new Set(sessions.map((s) => s.role));
  const showAssigneeFallback =
    sessions.length === 0 && !!task.assignee && !sessionRoles.has(task.assignee);

  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
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
        <span className="truncate font-mono text-[11px] text-foreground">
          {task.id}
        </span>

        <span className="mx-1 text-muted-foreground/40">·</span>

        <span className="inline-flex items-center gap-1">
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
          <span
            className={cn(
              "uppercase tracking-wide",
              task.state === "running" && "text-status-active",
              task.state === "done" && "text-status-completed",
              task.state === "failed" && "text-status-failed",
              task.state === "review" && "text-blue-400",
              (task.state === "todo" || task.state === "canceled") &&
                "text-muted-foreground",
            )}
          >
            {task.state}
          </span>
        </span>

        <span className="mx-1 text-muted-foreground/40">·</span>

        <span className="inline-flex items-center gap-1">
          <span
            className={cn("size-1.5 rounded-full", priorityColor(task.priority))}
          />
          <span>{priorityLabel(task.priority)}</span>
        </span>

        <span className="mx-1 text-muted-foreground/40">·</span>
        <span>
          by <span className="font-mono text-foreground">{task.createdBy}</span>
        </span>
        <span className="mx-1 text-muted-foreground/40">·</span>
        <span>{formatRelativeTime(task.createdAt)}</span>
        {sessions.filter((s) => s.alive).length > 0 && (
          <>
            <span className="mx-1 text-muted-foreground/40">|</span>
            {sessions
              .filter((s) => s.alive)
              .map((s, i) => (
                <span key={s.tmuxSession ?? s.role} className="inline-flex items-center gap-1">
                  {i > 0 && <span className="mx-0.5 text-muted-foreground/40">·</span>}
                  <span className="size-1.5 rounded-full bg-status-active animate-pulse" />
                  <span className="text-status-active">
                    {s.role.charAt(0).toUpperCase() + s.role.slice(1)} working...
                  </span>
                </span>
              ))}
          </>
        )}
        {task.linearIssueKey && (
          <>
            <span className="mx-1 text-muted-foreground/40">·</span>
            <span className="font-mono text-[10px] text-muted-foreground">
              {task.linearIssueKey}
            </span>
          </>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-3">
        {showAssigneeFallback ? (
          <button
            type="button"
            onClick={() => onPickContributor?.(task.assignee!)}
            title={task.assignee!}
            className="group relative flex items-center"
          >
            <span
              className={cn(
                "flex size-6 items-center justify-center rounded-full text-[11px] font-semibold ring-1 ring-border",
                roleAvatarClass(task.assignee!),
              )}
            >
              {agentInitial(task.assignee!)}
            </span>
          </button>
        ) : (
          <ContributorsBar sessions={sessions} onPick={onPickContributor} />
        )}
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
  );
}
