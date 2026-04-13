"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { agentInitial } from "@/lib/utils";
import { roleAvatarClass } from "@/components/task-detail/role-colors";
import { DispatchDialog } from "@/components/task-detail/DispatchDialog";
import type { Task, TaskEntityState } from "@/lib/types";

interface SubIssuesTreeProps {
  parentTaskId: string;
  children: Task[];
  onChanged?: () => void;
}

interface NodeState {
  loaded: boolean;
  loading: boolean;
  expanded: boolean;
  children: Task[];
}

const STATE_DOT: Record<TaskEntityState, string> = {
  todo: "border-muted-foreground/60",
  running: "border-status-active",
  review: "border-status-queued",
  done: "border-status-completed",
  failed: "border-status-failed",
  canceled: "border-muted-foreground/30",
};

const STATE_FILL: Record<TaskEntityState, string> = {
  todo: "bg-transparent",
  running: "bg-status-active/40",
  review: "bg-status-queued/40",
  done: "bg-status-completed",
  failed: "bg-status-failed",
  canceled: "bg-transparent",
};

function StateCircle({ state }: { state: TaskEntityState }) {
  return (
    <span
      className={cn(
        "inline-block size-3 shrink-0 rounded-full border-2",
        STATE_DOT[state] ?? STATE_DOT.todo,
        STATE_FILL[state] ?? STATE_FILL.todo,
      )}
    />
  );
}

function isDone(state: TaskEntityState): boolean {
  return state === "done" || state === "canceled";
}

export function SubIssuesTree({
  parentTaskId,
  children,
  onChanged,
}: SubIssuesTreeProps) {
  const router = useRouter();
  const [dispatchOpen, setDispatchOpen] = useState(false);
  // Map childId → its lazy-loaded descendants.
  const [nodeState, setNodeState] = useState<Record<string, NodeState>>({});

  const total = children.length;
  const doneCount = useMemo(
    () => children.filter((c) => isDone(c.state)).length,
    [children],
  );

  const toggle = useCallback(
    async (id: string) => {
      const cur = nodeState[id];
      if (cur?.loaded) {
        setNodeState((s) => ({ ...s, [id]: { ...cur, expanded: !cur.expanded } }));
        return;
      }
      setNodeState((s) => ({
        ...s,
        [id]: { loaded: false, loading: true, expanded: true, children: [] },
      }));
      try {
        const full = await api.tasks.getFull(id);
        setNodeState((s) => ({
          ...s,
          [id]: {
            loaded: true,
            loading: false,
            expanded: true,
            children: full.children ?? [],
          },
        }));
      } catch {
        setNodeState((s) => ({
          ...s,
          [id]: { loaded: true, loading: false, expanded: true, children: [] },
        }));
      }
    },
    [nodeState],
  );

  const navigate = (id: string) => {
    router.push(`/tasks?task=${encodeURIComponent(id)}`);
  };

  const renderNode = (t: Task, depth: number) => {
    const ns = nodeState[t.id];
    const expanded = ns?.expanded ?? false;
    const hasKnownChildren = (ns?.children.length ?? 0) > 0;
    return (
      <div key={t.id}>
        <div
          className="group relative flex items-center gap-2 rounded-md py-1 pr-2 hover:bg-accent/50"
          style={{ paddingLeft: 8 + depth * 16 }}
        >
          {depth > 0 && (
            <span
              aria-hidden
              className="pointer-events-none absolute left-0 top-0 h-full border-l border-border/60"
              style={{ left: depth * 16 - 8 }}
            />
          )}
          <button
            type="button"
            onClick={() => void toggle(t.id)}
            aria-label={expanded ? "Collapse" : "Expand"}
            className="flex size-4 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground"
          >
            <svg
              viewBox="0 0 16 16"
              className={cn(
                "size-3 transition-transform",
                expanded && "rotate-90",
              )}
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M6 4l4 4-4 4" />
            </svg>
          </button>
          <span
            className={cn(
              "flex size-4 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold",
              roleAvatarClass(t.createdBy ?? "engineer"),
            )}
          >
            {agentInitial(t.createdBy ?? "?")}
          </span>
          <StateCircle state={t.state} />
          <button
            type="button"
            onClick={() => navigate(t.id)}
            className="min-w-0 flex-1 truncate text-left text-[13px] text-foreground hover:underline"
          >
            {t.title || "(untitled)"}
          </button>
          {t.assignee && (
            <span
              className={cn(
                "ml-auto flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold",
                roleAvatarClass(t.assignee),
              )}
              title={t.assignee}
            >
              {agentInitial(t.assignee)}
            </span>
          )}
        </div>
        {expanded && (
          <div>
            {ns?.loading && (
              <div
                className="text-[11px] text-muted-foreground"
                style={{ paddingLeft: 8 + (depth + 1) * 16 + 24 }}
              >
                Loading…
              </div>
            )}
            {hasKnownChildren &&
              ns!.children.map((c) => renderNode(c, depth + 1))}
            {ns?.loaded && !hasKnownChildren && !ns.loading && (
              <div
                className="text-[11px] text-muted-foreground/70"
                style={{ paddingLeft: 8 + (depth + 1) * 16 + 24 }}
              >
                No sub-issues
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const empty = total === 0;
  return (
    <div
      className={cn(
        "rounded-md border border-border bg-card",
        empty && "border-border/60",
      )}
    >
      <div
        className={cn(
          "flex items-center justify-between px-3 py-1.5",
          !empty && "border-b border-border",
        )}
      >
        <div className="flex items-baseline gap-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Sub-issues
          </h3>
          <span className="text-[11px] tabular-nums text-muted-foreground">
            {empty ? "0" : `${doneCount}/${total}`}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setDispatchOpen(true)}
          aria-label="Add sub-issue"
          className="inline-flex size-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          title="Dispatch sub-issue"
        >
          <svg viewBox="0 0 16 16" className="size-3" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M8 3v10M3 8h10" />
          </svg>
        </button>
      </div>
      {!empty && (
        <div className="py-1">
          {children.map((c) => renderNode(c, 0))}
        </div>
      )}

      <DispatchDialog
        taskId={parentTaskId}
        open={dispatchOpen}
        onOpenChange={setDispatchOpen}
        onDispatched={() => {
          setDispatchOpen(false);
          onChanged?.();
        }}
      />
    </div>
  );
}
