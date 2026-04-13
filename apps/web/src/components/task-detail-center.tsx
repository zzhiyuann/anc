"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useWebSocket } from "@/lib/use-websocket";
import type {
  ProcessEvent,
  Task,
  TaskComment,
  TaskFull,
  WsMessage,
} from "@/lib/types";
import { TaskHeader } from "@/components/task-detail/TaskHeader";
import { ProcessStream } from "@/components/task-detail/ProcessStream";
import { ActivityStream } from "@/components/task-detail/ActivityStream";
import { AttachmentList } from "@/components/task-detail/AttachmentList";
import { HandoffRenderer } from "@/components/task-detail/HandoffRenderer";
import { DispatchDialog } from "@/components/task-detail/DispatchDialog";
import { MentionComposer } from "@/components/mention-composer";
import { SubIssuesTree } from "@/components/sub-issues-tree";
import { cn } from "@/lib/utils";

interface TaskDetailCenterProps {
  taskId: string;
  data: TaskFull;
  live: boolean;
  onRefresh: () => void | Promise<void>;
  // Notify parent of an optimistic field change so the list rail
  // (groupings, glyphs, row label) stays in sync with inline edits.
  onTaskPatch?: (patch: Partial<Task>) => void;
}

// =============== inline title editor ===============

function InlineTitle({
  value,
  onSave,
}: {
  value: string;
  onSave: (next: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  if (!editing) {
    return (
      <h1
        onClick={() => setEditing(true)}
        className="cursor-text text-[22px] font-semibold leading-tight tracking-tight text-foreground hover:bg-accent/40"
      >
        {value || "(untitled)"}
      </h1>
    );
  }

  return (
    <input
      autoFocus
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft.trim() && draft !== value) onSave(draft.trim());
        setEditing(false);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          if (draft.trim() && draft !== value) onSave(draft.trim());
          setEditing(false);
        }
        if (e.key === "Escape") {
          setDraft(value);
          setEditing(false);
        }
      }}
      className="w-full rounded-md border border-border bg-background px-2 py-1 text-[22px] font-semibold leading-tight tracking-tight text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
    />
  );
}

// =============== description editor ===============

interface SlashOption {
  key: string;
  label: string;
  hint: string;
  apply: (draft: string) => { next: string; caretDelta?: number };
}

const SLASH_OPTIONS: SlashOption[] = [
  {
    key: "heading",
    label: "Heading",
    hint: "## ",
    apply: (d) => ({ next: d.replace(/\/$/, "") + "## " }),
  },
  {
    key: "list",
    label: "Bulleted list",
    hint: "- ",
    apply: (d) => ({ next: d.replace(/\/$/, "") + "- " }),
  },
  {
    key: "numbered",
    label: "Numbered list",
    hint: "1. ",
    apply: (d) => ({ next: d.replace(/\/$/, "") + "1. " }),
  },
  {
    key: "code",
    label: "Code block",
    hint: "```",
    apply: (d) => ({ next: d.replace(/\/$/, "") + "```\n\n```" }),
  },
  {
    key: "quote",
    label: "Quote",
    hint: "> ",
    apply: (d) => ({ next: d.replace(/\/$/, "") + "> " }),
  },
  {
    key: "mention",
    label: "Mention",
    hint: "@",
    apply: (d) => ({ next: d.replace(/\/$/, "") + "@" }),
  },
  {
    key: "task",
    label: "Sub-task",
    hint: "- [ ] ",
    apply: (d) => ({ next: d.replace(/\/$/, "") + "- [ ] " }),
  },
];

function DescriptionBlock({
  task,
  onSave,
}: {
  task: Task;
  onSave: (next: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(task.description ?? "");
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashIndex, setSlashIndex] = useState(0);

  useEffect(() => {
    setDraft(task.description ?? "");
  }, [task.description]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value;
    setDraft(v);
    if (v.endsWith("/")) {
      setSlashOpen(true);
      setSlashIndex(0);
    } else {
      setSlashOpen(false);
    }
  };

  const applyOption = (opt: SlashOption) => {
    setDraft((d) => opt.apply(d).next);
    setSlashOpen(false);
  };

  if (!editing) {
    return (
      <div
        onClick={() => setEditing(true)}
        className={cn(
          "cursor-text rounded-md border border-transparent p-2 text-[13px] leading-relaxed",
          task.description
            ? "text-foreground/90 hover:border-border hover:bg-card/50"
            : "text-muted-foreground hover:border-border hover:bg-card/50",
        )}
      >
        {task.description ? (
          <p className="whitespace-pre-wrap">{task.description}</p>
        ) : (
          <p>Add a description…</p>
        )}
      </div>
    );
  }

  return (
    <div className="relative rounded-md border border-border bg-card">
      <textarea
        autoFocus
        rows={6}
        value={draft}
        onChange={handleChange}
        onKeyDown={(e) => {
          if (slashOpen) {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setSlashIndex((i) => (i + 1) % SLASH_OPTIONS.length);
              return;
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setSlashIndex(
                (i) => (i - 1 + SLASH_OPTIONS.length) % SLASH_OPTIONS.length,
              );
              return;
            }
            if (e.key === "Enter" && !e.metaKey && !e.ctrlKey) {
              e.preventDefault();
              applyOption(SLASH_OPTIONS[slashIndex]);
              return;
            }
            if (e.key === "Escape") {
              e.preventDefault();
              setSlashOpen(false);
              return;
            }
          }
          if (e.key === "Escape") {
            setEditing(false);
            setDraft(task.description ?? "");
          }
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            onSave(draft.trim() || null);
            setEditing(false);
          }
        }}
        placeholder="Markdown supported. / for commands, ⌘Enter to save, Esc to cancel."
        className="block w-full resize-none bg-transparent p-3 text-[13px] leading-relaxed text-foreground focus:outline-none"
      />
      {slashOpen && (
        <div className="absolute left-3 top-12 z-20 w-56 overflow-hidden rounded-md border border-border bg-popover py-1 shadow-lg">
          <div className="border-b border-border px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Insert
          </div>
          {SLASH_OPTIONS.map((opt, i) => (
            <button
              key={opt.key}
              type="button"
              onMouseEnter={() => setSlashIndex(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                applyOption(opt);
              }}
              className={cn(
                "flex w-full items-center justify-between gap-2 px-2 py-1 text-left text-[12px]",
                i === slashIndex
                  ? "bg-accent text-accent-foreground"
                  : "text-foreground hover:bg-accent/60",
              )}
            >
              <span>{opt.label}</span>
              <span className="font-mono text-[10px] text-muted-foreground">
                {opt.hint}
              </span>
            </button>
          ))}
        </div>
      )}
      <div className="flex items-center justify-between border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground">
        <span>Markdown · / for menu</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => {
              setDraft(task.description ?? "");
              setEditing(false);
            }}
            className="rounded px-2 py-0.5 hover:bg-accent hover:text-foreground"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              onSave(draft.trim() || null);
              setEditing(false);
            }}
            className="rounded bg-primary px-2 py-0.5 text-primary-foreground hover:opacity-90"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

// =============== runtime strip ===============

function deriveRuntimeStatus(
  events: TaskFull["events"],
  liveEvents: ProcessEvent[],
  taskId: string,
): { role: string | null; label: string; running: boolean } {
  // Find the newest tool-call-start (from live first, then history).
  for (let i = liveEvents.length - 1; i >= 0; i--) {
    const e = liveEvents[i];
    if (e.taskId !== taskId) continue;
    if (
      e.eventType.includes("tool-call-start") ||
      e.eventType.includes("bash") ||
      e.eventType.includes("file-")
    ) {
      return { role: e.role, label: e.preview, running: true };
    }
  }
  const sorted = [...events].sort((a, b) => b.createdAt - a.createdAt);
  for (const e of sorted) {
    if (
      e.type.includes("tool-call-start") ||
      e.type.includes("bash") ||
      e.type.includes("file-")
    ) {
      const p = (e.payload as Record<string, unknown> | null) ?? {};
      const label =
        (typeof p.preview === "string" && p.preview) ||
        (typeof p.input === "string" && p.input) ||
        (typeof p.file === "string" && p.file) ||
        e.type.replace("agent:", "");
      return { role: e.role ?? null, label: String(label), running: false };
    }
  }
  return { role: null, label: "Idle", running: false };
}

function RuntimeStrip({
  taskId,
  data,
  liveEvents,
}: {
  taskId: string;
  data: TaskFull;
  liveEvents: ProcessEvent[];
}) {
  const [expanded, setExpanded] = useState(false);
  const status = useMemo(
    () => deriveRuntimeStatus(data.events, liveEvents, taskId),
    [data.events, liveEvents, taskId],
  );

  const hasSession = (data.sessions?.length ?? 0) > 0;
  const hasLiveEvent = liveEvents.some((e) => e.taskId === taskId);
  // Hidden state: no past or present sessions and zero process events.
  if (!hasSession && !status.role && !hasLiveEvent) {
    return null;
  }

  const role = status.role ?? data.sessions[0]?.role ?? "engineer";
  const label = status.running ? status.label : "Idle";

  return (
    <div className="rounded-md border border-border bg-card">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left"
      >
        <div className="flex min-w-0 items-center gap-2 text-[11px]">
          <span
            className={cn(
              "size-2 shrink-0 rounded-full",
              status.running
                ? "bg-status-active animate-pulse"
                : "border border-muted-foreground/40 bg-transparent",
            )}
          />
          <span className="font-medium capitalize text-foreground">{role}</span>
          <span className="text-muted-foreground/40">·</span>
          <span className="min-w-0 truncate text-muted-foreground">{label}</span>
        </div>
        <span className="shrink-0 text-[10px] text-muted-foreground">
          {expanded ? "Collapse" : "Expand"}
        </span>
      </button>
      {expanded && (
        <div className="border-t border-border">
          <ProcessStream
            taskId={taskId}
            initialEvents={data.events}
            liveEvents={liveEvents}
          />
        </div>
      )}
    </div>
  );
}

// =============== main ===============

export function TaskDetailCenter({
  taskId,
  data,
  live,
  onRefresh,
  onTaskPatch,
}: TaskDetailCenterProps) {
  const [localData, setLocalData] = useState<TaskFull>(data);
  const [processEvents, setProcessEvents] = useState<ProcessEvent[]>([]);
  const [activeRole, setActiveRole] = useState<string | undefined>(undefined);
  const [dispatchOpen, setDispatchOpen] = useState(false);
  const [killing, setKilling] = useState(false);
  const lastRefreshRef = useRef(0);

  useEffect(() => {
    setProcessEvents([]);
    setActiveRole(undefined);
  }, [taskId]);

  useEffect(() => {
    setLocalData(data);
  }, [data]);

  const refresh = useCallback(async () => {
    const now = Date.now();
    if (now - lastRefreshRef.current < 500) return;
    lastRefreshRef.current = now;
    try {
      const next = await api.tasks.getFull(taskId);
      setLocalData(next);
    } catch {
      /* keep current */
    }
    await onRefresh();
  }, [taskId, onRefresh]);

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
            setLocalData((prev) =>
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
        case "agent:failed":
          void refresh();
          break;
        default:
          break;
      }
    });
    return unsub;
  }, [taskId, subscribeToTask, refresh]);

  const handleKill = async () => {
    if (!confirm(`Kill task ${localData.task.id}? All sessions will be stopped.`))
      return;
    setKilling(true);
    try {
      await api.tasks.remove(taskId);
      await onRefresh();
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
    setLocalData((prev) =>
      prev.comments.some((c) => c.id === comment.id)
        ? prev
        : { ...prev, comments: [...prev.comments, comment] },
    );
  };

  const handleTitleSave = async (next: string) => {
    setLocalData((prev) => ({ ...prev, task: { ...prev.task, title: next } }));
    onTaskPatch?.({ title: next });
    try {
      await api.tasks.update(taskId, { title: next });
    } catch {
      /* optimistic */
    }
  };

  const handleDescriptionSave = async (next: string | null) => {
    setLocalData((prev) => ({
      ...prev,
      task: { ...prev.task, description: next },
    }));
    onTaskPatch?.({ description: next });
    try {
      await api.tasks.update(taskId, { description: next });
    } catch {
      /* optimistic */
    }
  };

  const onPickContributor = (role: string) => {
    setActiveRole(role);
  };

  const t = localData.task;

  const hasAttachments = (localData.attachments?.length ?? 0) > 0;

  return (
    <div className="flex flex-col gap-4 px-6 py-4">
      {!live && (
        <div className="rounded-md border border-status-failed/30 bg-status-failed/10 px-3 py-2 text-[11px] text-status-failed">
          Failed to load task detail — using fallback data.
        </div>
      )}

      <TaskHeader
        task={t}
        sessions={localData.sessions}
        onDispatch={() => setDispatchOpen(true)}
        onKill={handleKill}
        onPickContributor={onPickContributor}
        killing={killing}
      />

      <InlineTitle value={t.title} onSave={handleTitleSave} />

      <DescriptionBlock task={t} onSave={handleDescriptionSave} />

      {/* Sub-issues — right under description, Linear-style */}
      <SubIssuesTree
        parentTaskId={taskId}
        children={localData.children}
        onChanged={() => void refresh()}
      />

      {/* Runtime strip (collapsed). Hidden entirely when no sessions/events. */}
      <section id="live-terminal-section">
        <RuntimeStrip
          taskId={taskId}
          data={localData}
          liveEvents={processEvents}
        />
      </section>

      {localData.handoff && <HandoffRenderer handoff={localData.handoff} />}

      {/* Activity (events + comments merged) */}
      <section>
        <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Activity
        </h3>
        <ActivityStream
          events={localData.events}
          comments={localData.comments}
        />
      </section>

      {/* Resources — hidden entirely when none */}
      {hasAttachments && (
        <section>
          <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Resources ({localData.attachments!.length})
          </h3>
          <AttachmentList
            taskId={taskId}
            attachments={localData.attachments ?? []}
          />
        </section>
      )}

      {/* Bottom composer */}
      <section className="sticky bottom-0 -mx-6 border-t border-border bg-background px-6 pb-4 pt-3">
        <MentionComposer taskId={taskId} onPosted={onCommentPosted} />
      </section>

      <DispatchDialog
        taskId={taskId}
        open={dispatchOpen}
        onOpenChange={setDispatchOpen}
        onDispatched={() => void refresh()}
      />
    </div>
  );
}
