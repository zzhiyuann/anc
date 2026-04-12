"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { useWebSocket } from "@/lib/use-websocket";
import type {
  ProcessEvent,
  Task,
  TaskComment,
  TaskEvent,
  TaskFull,
  WsMessage,
} from "@/lib/types";
import { TaskHeader } from "@/components/task-detail/TaskHeader";
import { TaskDescription } from "@/components/task-detail/TaskDescription";
import { LiveTerminalTabs } from "@/components/task-detail/LiveTerminalTabs";
import { ProcessStream } from "@/components/task-detail/ProcessStream";
import { CommentThread } from "@/components/task-detail/CommentThread";
import { CommentComposer } from "@/components/task-detail/CommentComposer";
import { AttachmentList } from "@/components/task-detail/AttachmentList";
import { DispatchTree } from "@/components/task-detail/DispatchTree";
import { ActivityTimeline } from "@/components/task-detail/ActivityTimeline";
import { CostCard } from "@/components/task-detail/CostCard";
import { MemoryTrailCard } from "@/components/task-detail/MemoryTrailCard";
import { HandoffRenderer } from "@/components/task-detail/HandoffRenderer";
import { DispatchDialog } from "@/components/task-detail/DispatchDialog";

interface TaskDetailViewProps {
  taskId: string;
  initial: TaskFull;
  live: boolean;
}

export function TaskDetailView({ taskId, initial, live }: TaskDetailViewProps) {
  const router = useRouter();
  const [data, setData] = useState<TaskFull>(initial);
  const [processEvents, setProcessEvents] = useState<ProcessEvent[]>([]);
  const [activeRole, setActiveRole] = useState<string | undefined>(undefined);
  const [dispatchOpen, setDispatchOpen] = useState(false);
  const [killing, setKilling] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const lastRefreshRef = useRef(0);

  // Refresh full task bundle.
  const refresh = useCallback(async () => {
    // Throttle refresh storms.
    const now = Date.now();
    if (now - lastRefreshRef.current < 500) return;
    lastRefreshRef.current = now;

    setRefreshing(true);
    try {
      const next = await api.tasks.getFull(taskId);
      setData(next);
    } catch {
      // Keep current data on failure.
    } finally {
      setRefreshing(false);
    }
  }, [taskId]);

  // WS subscription for this task.
  const { subscribeToTask } = useWebSocket();

  useEffect(() => {
    const unsub = subscribeToTask(taskId, (msg: WsMessage) => {
      switch (msg.type) {
        case "agent:process-event": {
          const ev = msg.data as ProcessEvent;
          setProcessEvents((prev) => [...prev, ev].slice(-500));
          break;
        }
        case "task:commented": {
          const c = msg.data as { comment?: TaskComment } | TaskComment;
          const comment =
            "comment" in c && c.comment ? c.comment : (c as TaskComment);
          if (comment && typeof comment === "object" && "id" in comment) {
            setData((prev) =>
              prev.comments.some((x) => x.id === comment.id)
                ? prev
                : { ...prev, comments: [...prev.comments, comment] },
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
        case "agent:failed": {
          // Coarse refresh — keeps sessions / state / handoff in sync.
          void refresh();
          break;
        }
        default:
          break;
      }
    });
    return unsub;
  }, [taskId, subscribeToTask, refresh]);

  const handleDispatched = () => {
    void refresh();
  };

  const handleKill = async () => {
    if (!confirm(`Kill task ${data.task.id}? All sessions will be stopped.`))
      return;
    setKilling(true);
    try {
      await api.tasks.remove(taskId);
      router.push("/tasks");
    } catch (err) {
      alert(
        err instanceof ApiError
          ? `Kill failed: ${err.message}`
          : "Kill failed (network)",
      );
    } finally {
      setKilling(false);
    }
  };

  const onCommentPosted = (comment: TaskComment) => {
    setData((prev) =>
      prev.comments.some((c) => c.id === comment.id)
        ? prev
        : { ...prev, comments: [...prev.comments, comment] },
    );
  };

  const onPickContributor = (role: string) => {
    setActiveRole(role);
    // Scroll the terminal section into view.
    document
      .getElementById("live-terminal-section")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // Map first-class Task → role list helper for header (already from sessions).
  const t: Task = data.task;

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-5 p-6">
      {!live && (
        <div className="rounded-md border border-status-failed/30 bg-status-failed/10 px-3 py-2 text-xs text-status-failed">
          Mock data — backend offline or task not found. Some actions are
          simulated.
        </div>
      )}

      <TaskHeader
        task={t}
        sessions={data.sessions}
        onDispatch={() => setDispatchOpen(true)}
        onKill={handleKill}
        onPickContributor={onPickContributor}
        killing={killing}
      />

      <TaskDescription task={t} />

      <section id="live-terminal-section">
        <h3 className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Live terminal
        </h3>
        <LiveTerminalTabs
          taskId={taskId}
          sessions={data.sessions}
          activeRole={activeRole}
          onActiveRoleChange={setActiveRole}
        />
      </section>

      <section>
        <ProcessStream
          taskId={taskId}
          initialEvents={data.events}
          liveEvents={processEvents}
        />
      </section>

      {data.handoff && (
        <section>
          <HandoffRenderer handoff={data.handoff} />
        </section>
      )}

      {/* Two-column layout */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-5">
          <section>
            <h3 className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Comments ({data.comments.length})
            </h3>
            <CommentThread comments={data.comments} />
            <div className="mt-3">
              <CommentComposer taskId={taskId} onPosted={onCommentPosted} />
            </div>
          </section>

          <section>
            <h3 className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Attachments ({data.attachments.length})
            </h3>
            <AttachmentList taskId={taskId} attachments={data.attachments} />
          </section>

          <section>
            <h3 className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Dispatch tree
            </h3>
            <DispatchTree
              parentTaskId={t.parentTaskId}
              children={data.children}
            />
          </section>
        </div>

        <aside className="space-y-5">
          <section>
            <h3 className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Activity {refreshing && "· refreshing"}
            </h3>
            <ActivityTimeline events={data.events} />
          </section>

          <CostCard cost={data.cost} />

          <MemoryTrailCard events={data.events} />
        </aside>
      </div>

      <DispatchDialog
        taskId={taskId}
        open={dispatchOpen}
        onOpenChange={setDispatchOpen}
        onDispatched={handleDispatched}
      />
    </div>
  );
}
