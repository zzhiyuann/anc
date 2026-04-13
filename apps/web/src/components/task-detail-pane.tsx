"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ExternalLink, RefreshCw } from "lucide-react";
import { api } from "@/lib/api";
import { useWebSocket } from "@/lib/use-websocket";
import type {
  ProcessEvent,
  ProjectWithStats,
  Task,
  TaskComment,
  TaskFull,
  WsMessage,
} from "@/lib/types";
import { TaskHeader } from "@/components/task-detail/TaskHeader";
import { TaskDescription } from "@/components/task-detail/TaskDescription";
import { LiveTerminalTabs } from "@/components/task-detail/LiveTerminalTabs";
import { ProcessStream } from "@/components/task-detail/ProcessStream";
import { CommentThread } from "@/components/task-detail/CommentThread";
import { CommentComposer } from "@/components/task-detail/CommentComposer";
import { TaskPropertiesPanel } from "@/components/task-properties-panel";
import { EmptyState } from "@/components/empty-state";

interface TaskDetailPaneProps {
  taskId: string | null;
  projects: ProjectWithStats[];
}

/**
 * Compact, embedded version of the task detail view used in the
 * three-pane master-detail layout. Reuses the heavy components from
 * `task-detail/*` but lays them out for the narrower right pane.
 */
export function TaskDetailPane({ taskId, projects }: TaskDetailPaneProps) {
  const [data, setData] = useState<TaskFull | null>(null);
  const [loading, setLoading] = useState(false);
  const [processEvents, setProcessEvents] = useState<ProcessEvent[]>([]);
  const [activeRole, setActiveRole] = useState<string | undefined>(undefined);
  const lastRefresh = useRef(0);

  const refresh = useCallback(async () => {
    if (!taskId) return;
    const now = Date.now();
    if (now - lastRefresh.current < 400) return;
    lastRefresh.current = now;
    try {
      const next = await api.tasks.getFull(taskId);
      setData(next);
    } catch {
      // keep last
    }
  }, [taskId]);

  useEffect(() => {
    if (!taskId) {
      setData(null);
      setProcessEvents([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const next = await api.tasks.getFull(taskId);
        if (!cancelled) {
          setData(next);
          setProcessEvents([]);
          setActiveRole(undefined);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [taskId]);

  const { subscribeToTask } = useWebSocket();

  useEffect(() => {
    if (!taskId) return;
    const unsub = subscribeToTask(taskId, (msg: WsMessage) => {
      switch (msg.type) {
        case "agent:process-event": {
          const ev = msg.data as ProcessEvent;
          setProcessEvents((prev) => [...prev, ev].slice(-300));
          break;
        }
        case "task:commented": {
          const c = msg.data as { comment?: TaskComment } | TaskComment;
          const comment =
            "comment" in c && c.comment ? c.comment : (c as TaskComment);
          if (comment && typeof comment === "object" && "id" in comment) {
            setData((prev) =>
              prev && !prev.comments.some((x) => x.id === comment.id)
                ? { ...prev, comments: [...prev.comments, comment] }
                : prev,
            );
          }
          break;
        }
        case "task:dispatched":
        case "agent:spawned":
        case "agent:idle":
        case "agent:suspended":
        case "agent:resumed":
        case "task:completed":
        case "agent:completed":
        case "agent:failed":
          void refresh();
          break;
      }
    });
    return unsub;
  }, [taskId, subscribeToTask, refresh]);

  if (!taskId) {
    return (
      <div className="flex h-full items-center justify-center">
        <EmptyState
          illustration="select"
          title="Select a task to view details"
          description="Pick any task from the list to see its terminal, process events, comments and properties — all live."
        />
      </div>
    );
  }

  if (loading && !data) {
    return (
      <div className="flex h-full items-center justify-center text-[12px] text-muted-foreground">
        Loading task…
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex h-full items-center justify-center text-[12px] text-muted-foreground">
        Task not found.
      </div>
    );
  }

  const t: Task = data.task;

  const handlePatch = (patch: Partial<Task>) => {
    setData((prev) => (prev ? { ...prev, task: { ...prev.task, ...patch } } : prev));
  };

  const onCommentPosted = (comment: TaskComment) => {
    setData((prev) =>
      prev && !prev.comments.some((c) => c.id === comment.id)
        ? { ...prev, comments: [...prev.comments, comment] }
        : prev,
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Top toolbar */}
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-border px-4">
        <div className="flex items-center gap-2 text-[11px] font-mono text-muted-foreground">
          <span>{t.id.replace("task-", "").slice(0, 8)}</span>
          <span>·</span>
          <span className="capitalize">{t.state}</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => void refresh()}
            className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
            title="Refresh"
          >
            <RefreshCw className="size-3.5" />
          </button>
          <Link
            href={`/tasks/${encodeURIComponent(t.id)}`}
            className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
            title="Open full screen"
          >
            <ExternalLink className="size-3.5" />
          </Link>
        </div>
      </div>

      {/* Main scroll area + properties sidebar */}
      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_240px]">
        <div className="min-h-0 overflow-y-auto px-5 py-4">
          <TaskHeader
            task={t}
            sessions={data.sessions}
            onDispatch={() => {}}
            onKill={() => {}}
            onPickContributor={(role) => setActiveRole(role)}
            killing={false}
          />

          <div className="mt-4">
            <TaskDescription task={t} />
          </div>

          {data.sessions.length > 0 && (
            <section className="mt-5">
              <h3 className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Live terminal
              </h3>
              <LiveTerminalTabs
                taskId={t.id}
                sessions={data.sessions}
                activeRole={activeRole}
                onActiveRoleChange={setActiveRole}
              />
            </section>
          )}

          <section className="mt-5">
            <ProcessStream
              taskId={t.id}
              initialEvents={data.events}
              liveEvents={processEvents}
            />
          </section>

          <section className="mt-5">
            <h3 className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Comments ({data.comments.length})
            </h3>
            <CommentThread comments={data.comments} />
            <div className="mt-3">
              <CommentComposer taskId={t.id} onPosted={onCommentPosted} />
            </div>
          </section>
        </div>

        <aside className="hidden min-h-0 overflow-y-auto lg:block">
          <TaskPropertiesPanel
            data={data}
            projects={projects}
            onUpdated={handlePatch}
          />
        </aside>
      </div>
    </div>
  );
}
