"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api, ApiError } from "@/lib/api";
import { useWebSocket } from "@/lib/use-websocket";
import { cn, formatRelativeTime } from "@/lib/utils";
import {
  HEALTH_DOT_CLASS,
  HEALTH_LABEL,
  HEALTH_TEXT_CLASS,
  getProjectMeta,
} from "@/components/projects/local-meta";
import { ProgressBar } from "@/components/projects/progress-bar";
import type {
  AgentStatus,
  EventRow,
  Project,
  ProjectStats,
  Task,
  TaskEntityState,
} from "@/lib/types";

interface Props {
  project: Project;
  recentTasks: Task[];
  stats: ProjectStats;
  live: boolean;
}

function fmtUsd(usd: number): string {
  if (usd === 0) return "$0.00";
  if (usd < 0.01) return "<$0.01";
  return `$${usd.toFixed(2)}`;
}

function eventCreatedAtMs(ev: EventRow): number {
  const iso = ev.createdAt.includes("T") ? ev.createdAt : ev.createdAt.replace(" ", "T") + "Z";
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
}

const TASK_STATE_DOT: Record<TaskEntityState, string> = {
  todo: "bg-muted-foreground",
  running: "bg-status-active",
  review: "bg-status-queued",
  done: "bg-status-completed",
  failed: "bg-status-failed",
  canceled: "bg-muted",
};

const TASK_STATE_GROUPS: Array<{ key: TaskEntityState; label: string }> = [
  { key: "running", label: "In progress" },
  { key: "review", label: "In review" },
  { key: "todo", label: "Todo" },
  { key: "done", label: "Done" },
  { key: "failed", label: "Failed" },
  { key: "canceled", label: "Canceled" },
];

const DAY_MS = 24 * 60 * 60 * 1000;

export function ProjectDetailView({
  project: initialProject,
  recentTasks: initialTasks,
  stats: initialStats,
  live,
}: Props) {
  const router = useRouter();
  const [project, setProject] = useState(initialProject);
  const [stats, setStats] = useState(initialStats);
  const [tasks, setTasks] = useState<Task[]>(initialTasks);
  const [agents, setAgents] = useState<AgentStatus[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [editingName, setEditingName] = useState(false);
  const [editingDesc, setEditingDesc] = useState(false);
  const [nameDraft, setNameDraft] = useState(project.name);
  const [descDraft, setDescDraft] = useState(project.description ?? "");
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [creatingTask, setCreatingTask] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const { lastMessage } = useWebSocket();

  const meta = getProjectMeta(project.id);
  const accent = project.color || "#6b7280";
  const archived = project.state === "archived";

  // Load tasks (full list, not just recent), agents, events.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [list, agentList, evs] = await Promise.all([
          api.tasks.listByProject(project.id).catch(() => initialTasks),
          api.agents.list().catch(() => [] as AgentStatus[]),
          api.events.list(200).catch(() => [] as EventRow[]),
        ]);
        if (cancelled) return;
        setTasks(list);
        setAgents(agentList);
        setEvents(evs);
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [project.id]);

  useEffect(() => {
    if (!lastMessage) return;
    const t = lastMessage.type;
    if (t === "task:created" || t === "task:completed" || t === "agent:spawned" || t === "agent:completed") {
      void refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastMessage]);

  const refresh = async () => {
    try {
      const [data, list, evs] = await Promise.all([
        api.projects.get(project.id),
        api.tasks.listByProject(project.id),
        api.events.list(200),
      ]);
      setProject(data.project);
      setStats(data.stats);
      setTasks(list);
      setEvents(evs);
    } catch {
      // keep current
    }
  };

  // --- Derived state ---

  const projectIssueKeys = useMemo(() => {
    const set = new Set<string>();
    for (const t of tasks) {
      if (t.linearIssueKey) set.add(t.linearIssueKey);
    }
    return set;
  }, [tasks]);

  const projectEvents = useMemo(
    () => events.filter((e) => e.issueKey && projectIssueKeys.has(e.issueKey)),
    [events, projectIssueKeys],
  );

  // Cost burn sparkline: bucket task spend per day for last 14 days.
  // Backend gap: `/events` does not accept projectId, and per-task cost is
  // not exposed on Task — we approximate using stats.totalCostUsd spread by
  // task createdAt, anchored at task creation date. This is a stub bar
  // when richer data isn't available.
  const burnDays = useMemo(() => {
    const now = Date.now();
    const start = now - 13 * DAY_MS;
    const buckets: number[] = new Array(14).fill(0);
    if (tasks.length > 0 && stats.totalCostUsd > 0) {
      const perTask = stats.totalCostUsd / tasks.length;
      for (const t of tasks) {
        if (t.createdAt < start) continue;
        const idx = Math.min(13, Math.floor((t.createdAt - start) / DAY_MS));
        if (idx >= 0) buckets[idx] += perTask;
      }
    }
    return buckets;
  }, [tasks, stats.totalCostUsd]);

  // Active agents in this project: agents with sessions whose issueKey is
  // attached to a task in this project.
  const projectAgents = useMemo(() => {
    return agents.filter((a) =>
      a.sessions.some((s) => projectIssueKeys.has(s.issueKey)),
    );
  }, [agents, projectIssueKeys]);

  const grouped = useMemo(() => {
    const map: Record<TaskEntityState, Task[]> = {
      todo: [],
      running: [],
      review: [],
      done: [],
      failed: [],
      canceled: [],
    };
    for (const t of tasks) map[t.state].push(t);
    return map;
  }, [tasks]);

  const targetCountdown = useMemo(() => {
    if (!meta.targetDate) return null;
    const t = Date.parse(meta.targetDate + "T00:00:00");
    if (!Number.isFinite(t)) return null;
    const days = Math.ceil((t - Date.now()) / DAY_MS);
    return days;
  }, [meta.targetDate]);

  // --- Handlers ---

  const saveName = async () => {
    const next = nameDraft.trim();
    setEditingName(false);
    if (next.length < 2 || next === project.name) {
      setNameDraft(project.name);
      return;
    }
    setProject((p) => ({ ...p, name: next }));
    try {
      const updated = await api.projects.update(project.id, { name: next });
      setProject((p) => ({ ...p, ...updated }));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to rename");
      void refresh();
    }
  };

  const saveDesc = async () => {
    const next = descDraft.trim() || null;
    setEditingDesc(false);
    if (next === (project.description ?? null)) return;
    setProject((p) => ({ ...p, description: next }));
    try {
      const updated = await api.projects.update(project.id, { description: next });
      setProject((p) => ({ ...p, ...updated }));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to save description");
      void refresh();
    }
  };

  const createTask = async (e: React.FormEvent) => {
    e.preventDefault();
    const title = newTaskTitle.trim();
    if (!title) return;
    setCreatingTask(true);
    try {
      await api.tasks.create({ title, projectId: project.id });
      setNewTaskTitle("");
      await refresh();
      toast.success("Task created");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to create task");
    } finally {
      setCreatingTask(false);
    }
  };

  const toggleArchive = async () => {
    if (!archived) {
      if (typeof window !== "undefined" && !window.confirm(
        `Archive "${project.name}"? Active sessions are not affected, but the project will be hidden from the active list.`,
      )) return;
    }
    setArchiving(true);
    try {
      const nextState = archived ? "active" : "archived";
      const updated = await api.projects.update(project.id, { state: nextState });
      setProject((p) => ({ ...p, ...updated }));
      toast.success(archived ? "Project restored" : "Project archived");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to update state");
    } finally {
      setArchiving(false);
    }
  };

  const newTaskHref = `/tasks?new=1&projectId=${encodeURIComponent(project.id)}`;
  const taskHref = (taskId: string) =>
    `/tasks?task=${encodeURIComponent(taskId)}&projectId=${encodeURIComponent(project.id)}`;

  const maxBurn = Math.max(...burnDays, 0.0001);

  return (
    <div className="flex h-full flex-col">
      {/* Archived banner */}
      {archived && (
        <div className="flex items-center justify-between border-b border-status-queued/30 bg-status-queued/10 px-6 py-2 text-[12px]">
          <span className="text-status-queued">
            Archived {project.archivedAt ? formatRelativeTime(project.archivedAt) : ""}
          </span>
          <Button size="sm" variant="outline" className="h-7" onClick={toggleArchive} disabled={archiving}>
            {archiving ? "Restoring…" : "Restore"}
          </Button>
        </div>
      )}

      {/* Header */}
      <header className="border-b border-border px-6 py-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <div
              className="size-10 shrink-0 rounded-md"
              style={{ backgroundColor: accent }}
              aria-hidden
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                {editingName ? (
                  <Input
                    autoFocus
                    value={nameDraft}
                    onChange={(e) => setNameDraft(e.target.value)}
                    onBlur={saveName}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveName();
                      if (e.key === "Escape") {
                        setNameDraft(project.name);
                        setEditingName(false);
                      }
                    }}
                    className="h-7 w-72 text-[18px] font-semibold"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => setEditingName(true)}
                    className="truncate rounded text-left text-[18px] font-semibold tracking-tight hover:bg-accent/50"
                  >
                    {project.name}
                  </button>
                )}
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
                    HEALTH_TEXT_CLASS[meta.health],
                  )}
                >
                  <span className={cn("size-1.5 rounded-full", HEALTH_DOT_CLASS[meta.health])} />
                  {HEALTH_LABEL[meta.health]}
                </span>
                <span className="rounded border border-border px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                  {project.state}
                </span>
              </div>
              {editingDesc ? (
                <Textarea
                  autoFocus
                  value={descDraft}
                  onChange={(e) => setDescDraft(e.target.value)}
                  onBlur={saveDesc}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      setDescDraft(project.description ?? "");
                      setEditingDesc(false);
                    }
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) saveDesc();
                  }}
                  rows={2}
                  className="mt-1 max-w-2xl text-[13px]"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setEditingDesc(true)}
                  className="mt-1 block max-w-2xl rounded text-left text-[13px] text-muted-foreground hover:bg-accent/50"
                >
                  {project.description || "Add a description…"}
                </button>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                <span>
                  Lead: <span className="text-foreground">{meta.lead ?? "—"}</span>
                </span>
                <span>
                  Target: <span className="text-foreground">{meta.targetDate ?? "—"}</span>
                  {targetCountdown !== null && (
                    <span
                      className={cn(
                        "ml-1",
                        targetCountdown < 0
                          ? "text-status-failed"
                          : targetCountdown < 7
                            ? "text-status-queued"
                            : "text-muted-foreground",
                      )}
                    >
                      ({targetCountdown < 0 ? `${-targetCountdown}d overdue` : `${targetCountdown}d left`})
                    </span>
                  )}
                </span>
                <span>Created {formatRelativeTime(project.createdAt)} by {project.createdBy}</span>
                {!live && <span className="text-status-queued">mock data</span>}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link href={newTaskHref}>
              <Button size="sm" className="h-8 gap-1.5">
                <PlusIcon />
                New task
              </Button>
            </Link>
            <Button
              size="sm"
              variant="outline"
              className="h-8"
              onClick={toggleArchive}
              disabled={archiving}
            >
              {archived ? "Restore" : "Archive"}
            </Button>
            <Button size="sm" variant="outline" className="h-8" onClick={() => router.push("/projects")}>
              Back
            </Button>
          </div>
        </div>

        {/* Stats row */}
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
          <StatCard label="Todo" value={grouped.todo.length} />
          <StatCard label="Running" value={grouped.running.length} accent="text-status-active" />
          <StatCard label="Review" value={grouped.review.length} accent="text-status-queued" />
          <StatCard label="Done" value={grouped.done.length} accent="text-status-completed" />
          <StatCard label="Spent" value={fmtUsd(stats.totalCostUsd)} />
        </div>
        <div className="mt-3">
          <ProgressBar value={stats.total > 0 ? (stats.done / stats.total) * 100 : 0} />
        </div>
      </header>

      {/* Two-pane body */}
      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[60%_40%]">
        {/* Left pane: tasks */}
        <div className="min-h-0 overflow-auto border-r border-border">
          <div className="border-b border-border px-6 py-4">
            <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Tasks
            </h2>
            <form onSubmit={createTask} className="flex items-center gap-2">
              <Input
                value={newTaskTitle}
                onChange={(e) => setNewTaskTitle(e.target.value)}
                placeholder="New task title…"
                className="h-8"
                disabled={creatingTask}
              />
              <Button type="submit" size="sm" className="h-8" disabled={creatingTask || !newTaskTitle.trim()}>
                {creatingTask ? "Adding…" : "Add"}
              </Button>
            </form>
          </div>

          {tasks.length === 0 ? (
            <div className="px-6 py-12 text-center text-[13px] text-muted-foreground">
              No tasks in this project yet ·{" "}
              <Link href={newTaskHref} className="text-foreground underline">
                Create task
              </Link>
            </div>
          ) : (
            <div>
              {TASK_STATE_GROUPS.map((g) => {
                const list = grouped[g.key];
                if (list.length === 0) return null;
                return (
                  <section key={g.key} className="border-b border-border last:border-b-0">
                    <header className="flex items-center gap-2 bg-accent/30 px-6 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      <span className={cn("size-1.5 rounded-full", TASK_STATE_DOT[g.key])} />
                      <span>{g.label}</span>
                      <span className="font-mono text-muted-foreground/70">{list.length}</span>
                    </header>
                    <ul>
                      {list.map((task) => (
                        <li key={task.id}>
                          <Link
                            href={taskHref(task.id)}
                            className="flex items-center gap-3 border-b border-border/60 px-6 py-2 text-[13px] last:border-b-0 hover:bg-accent/40"
                          >
                            <span className="flex-1 truncate">{task.title}</span>
                            <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                              P{task.priority}
                            </span>
                            <span className="w-20 text-right text-[11px] text-muted-foreground">
                              {task.assignee ?? "—"}
                            </span>
                            <span className="w-24 text-right text-[11px] text-muted-foreground">
                              {formatRelativeTime(task.createdAt)}
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })}
            </div>
          )}
        </div>

        {/* Right pane */}
        <div className="min-h-0 overflow-auto">
          {/* Active agents */}
          <Section title="Active agents">
            {projectAgents.length === 0 ? (
              <p className="text-[12px] text-muted-foreground">No agents currently working on this project.</p>
            ) : (
              <ul className="space-y-2">
                {projectAgents.map((a) => {
                  const projectSessions = a.sessions.filter((s) =>
                    projectIssueKeys.has(s.issueKey),
                  );
                  return (
                    <li
                      key={a.role}
                      className="rounded-md border border-border bg-card p-3"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="flex size-6 items-center justify-center rounded-full bg-accent text-[11px] font-medium">
                            {a.name.slice(0, 1)}
                          </span>
                          <span className="text-[13px] font-medium">{a.name}</span>
                        </div>
                        <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                          {projectSessions.length} session{projectSessions.length === 1 ? "" : "s"}
                        </span>
                      </div>
                      <ul className="mt-2 space-y-1">
                        {projectSessions.map((s) => (
                          <li
                            key={s.issueKey}
                            className="flex items-center justify-between text-[11px]"
                          >
                            <span className="font-mono text-muted-foreground">{s.issueKey}</span>
                            <span className="text-muted-foreground">{s.state}</span>
                          </li>
                        ))}
                      </ul>
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>

          {/* Cost burn sparkline */}
          <Section title="Cost burn · 14 days">
            <div className="rounded-md border border-border bg-card p-3">
              <div className="flex h-16 items-end gap-1">
                {burnDays.map((v, i) => (
                  <div
                    key={i}
                    className="flex-1 rounded-sm bg-status-active/60"
                    style={{ height: `${(v / maxBurn) * 100}%`, minHeight: 1 }}
                    title={fmtUsd(v)}
                  />
                ))}
              </div>
              <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
                <span>14d ago</span>
                <span>Total: {fmtUsd(burnDays.reduce((s, v) => s + v, 0))}</span>
                <span>Today</span>
              </div>
            </div>
          </Section>

          {/* Recent activity */}
          <Section title="Recent activity">
            {projectEvents.length === 0 ? (
              <p className="text-[12px] text-muted-foreground">No recent activity.</p>
            ) : (
              <ul className="space-y-1.5">
                {projectEvents.slice(0, 20).map((ev) => (
                  <li
                    key={ev.id}
                    className="flex items-start gap-2 text-[12px]"
                  >
                    <span className="mt-1 size-1 shrink-0 rounded-full bg-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-foreground">{ev.eventType}</span>
                        {ev.role && (
                          <span className="text-muted-foreground">· {ev.role}</span>
                        )}
                        {ev.issueKey && (
                          <span className="font-mono text-muted-foreground">· {ev.issueKey}</span>
                        )}
                      </div>
                      {ev.detail && (
                        <p className="truncate text-[11px] text-muted-foreground">{ev.detail}</p>
                      )}
                      <p className="text-[10px] text-muted-foreground">
                        {formatRelativeTime(eventCreatedAtMs(ev))}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-b border-border px-6 py-4 last:border-b-0">
      <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h2>
      {children}
    </section>
  );
}

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: number | string;
  accent?: string;
}) {
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2">
      <div className={cn("font-mono text-[18px] tabular-nums text-foreground", accent)}>
        {value}
      </div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
    </div>
  );
}

function PlusIcon() {
  return (
    <svg className="size-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M8 3v10M3 8h10" />
    </svg>
  );
}
