"use client";

import Link from "next/link";
import type { Task } from "@/lib/types";
import { cn } from "@/lib/utils";
import { taskStateClass } from "./role-colors";

interface DispatchTreeProps {
  parentTaskId: string | null;
  children: Task[];
}

export function DispatchTree({ parentTaskId, children }: DispatchTreeProps) {
  if (!parentTaskId && children.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
        No dispatched sub-tasks. Use [Dispatch] to spawn one.
      </p>
    );
  }

  return (
    <div className="space-y-2 text-sm">
      {parentTaskId && (
        <div className="rounded-lg border border-border bg-card p-2">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Parent
          </div>
          <Link
            href={`/tasks/${encodeURIComponent(parentTaskId)}`}
            className="mt-1 block truncate font-mono text-xs text-foreground hover:text-blue-400"
          >
            ← {parentTaskId}
          </Link>
        </div>
      )}

      {children.length > 0 && (
        <div>
          <div className="mb-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
            Dispatched ({children.length})
          </div>
          <ul className="space-y-1">
            {children.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/tasks/${encodeURIComponent(c.id)}`}
                  className="flex items-center gap-2 rounded-md border border-border bg-card p-2 transition-colors hover:border-border/80 hover:bg-card/80"
                >
                  <span className="text-muted-foreground">↳</span>
                  <span className="min-w-0 flex-1 truncate text-xs">
                    {c.title}
                  </span>
                  <span
                    className={cn(
                      "rounded border px-1.5 py-0.5 text-[10px] uppercase",
                      taskStateClass(c.state),
                    )}
                  >
                    {c.state}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
