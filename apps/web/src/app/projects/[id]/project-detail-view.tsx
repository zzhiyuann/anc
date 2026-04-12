"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { useWebSocket } from "@/lib/use-websocket";
import { cn, formatRelativeTime } from "@/lib/utils";
import type { Project, ProjectStats, Task, EventRow } from "@/lib/types";

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

const STATE_CLASS: Record<Project["state"], string> = {
  active: "bg-emerald-500/15 text-emerald-400 ring-emerald-500/30",
  paused: "bg-amber-500/15 text-amber-400 ring-amber-500/30",
  archived: "bg-muted text-muted-foreground ring-border",
};

export function ProjectDetailView({
  project: initialProject,
  recentTasks: initialTasks,
  stats: initialStats,
  live,
}: Props) {
  const [project, setProject] = useState(initialProject);
  const [recentTasks, setRecentTasks] = useState(initialTasks);
  const [stats, setStats] = useState(initialStats);
  const [activity, setActivity] = useState<EventRow[]>([]);
  const { lastMessage } = useWebSocket();

  const accent = project.color || "#6b7280";
  // Mock data sometimes uses string names ("rocket"); only render single-char glyphs as icon, otherwise fall back to a default emoji.
  const rawIcon = project.icon ?? "📁";
  const icon = rawIcon.length <= 2 ? rawIcon : "📁";

  // Initial activity load.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const evs = await api.events.list(50);
        if (cancelled) return;
        // Filter to events tied to a task in this project, if we can correlate.
        const taskIds = new Set(recentTasks.map((t) => t.id));
        const linearKeys = new Set(
          recentTasks.map((t) => t.linearIssueKey).filter((k): k is string => !!k),
        );
        setActivity(
          evs.filter(
            (e) =>
              (e.issueKey && (taskIds.has(e.issueKey) || linearKeys.has(e.issueKey))) ||
              false,
          ),
        );
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [recentTasks]);

  // Refresh on relevant WS events.
  useEffect(() => {
    if (!lastMessage) return;
    const t = lastMessage.type;
    if (t === "task:created" || t === "task:completed") {
      void refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastMessage]);

  const refresh = async () => {
    try {
      const data = await api.projects.get(project.id);
      setProject(data.project);
      setRecentTasks(data.recentTasks);
      setStats(data.stats);
    } catch {
      // keep current
    }
  };

  const newTaskHref = `/tasks?new=1&projectId=${encodeURIComponent(project.id)}`;

  return (
    <div className="p-6">
      {/* Header */}
      <div
        className="relative overflow-hidden rounded-2xl border border-border bg-card p-6"
        style={{
          background: `linear-gradient(135deg, ${accent}1a 0%, transparent 60%)`,
        }}
      >
        <div className="absolute inset-x-0 top-0 h-1" style={{ backgroundColor: accent }} />
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <div
              className="flex size-14 items-center justify-center rounded-2xl text-3xl"
              style={{
                backgroundColor: `${accent}26`,
                boxShadow: `inset 0 0 0 1px ${accent}40`,
              }}
            >
              {icon}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-semibold tracking-tight">{project.name}</h1>
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[10px] font-medium uppercase ring-1",
                    STATE_CLASS[project.state],
                  )}
                >
                  {project.state}
                </span>
              </div>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                {project.description || "No description"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Created {formatRelativeTime(project.createdAt)} by {project.createdBy}
                {!live && " (mock data — backend offline)"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link href={newTaskHref}>
              <Button size="sm" className="gap-1.5">
                <svg
                  className="size-3.5"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M8 3v10M3 8h10" />
                </svg>
                New Task
              </Button>
            </Link>
            <Button size="sm" variant="outline" disabled title="Edit (coming soon)">
              Edit
            </Button>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Total tasks" value={String(stats.total)} />
        <StatCard label="Running" value={String(stats.running)} accent="text-status-active" />
        <StatCard label="Queued" value={String(stats.queued)} accent="text-status-idle" />
        <StatCard label="Done" value={String(stats.done)} accent="text-emerald-400" />
        <StatCard label="Total cost" value={fmtUsd(stats.totalCostUsd)} />
        <StatCard
          label="Avg / task"
          value={fmtUsd(stats.total > 0 ? stats.totalCostUsd / stats.total : 0)}
        />
      </div>

      {/* Recent tasks */}
      <section className="mt-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Recent tasks
        </h2>
        <div className="rounded-xl border border-border bg-card">
          {recentTasks.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              No tasks in this project yet.{" "}
              <Link href={newTaskHref} className="text-foreground underline">
                Create one
              </Link>
              .
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {recentTasks.map((task) => (
                <li key={task.id}>
                  <Link
                    href={`/tasks/${encodeURIComponent(task.id)}`}
                    className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-secondary/40"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{task.title}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {task.state} · created {formatRelativeTime(task.createdAt)}
                      </p>
                    </div>
                    <span className="font-mono text-xs text-muted-foreground">
                      {task.linearIssueKey ?? task.id.slice(0, 8)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* Activity */}
      <section className="mt-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Activity
        </h2>
        <div className="rounded-xl border border-border bg-card">
          {activity.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              No recent activity.
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {activity.map((ev) => (
                <li key={ev.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm">
                      <span className="font-mono text-xs text-muted-foreground">
                        {ev.eventType}
                      </span>
                      {ev.detail && <span className="ml-2">{ev.detail}</span>}
                    </p>
                  </div>
                  <span className="font-mono text-xs text-muted-foreground">
                    {formatRelativeTime(ev.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn("mt-1 font-mono text-xl font-semibold", accent)}>{value}</p>
    </div>
  );
}
