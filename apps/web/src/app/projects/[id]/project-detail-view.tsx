"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { useWebSocket } from "@/lib/use-websocket";
import { cn, formatRelativeTime } from "@/lib/utils";
import {
  HEALTH_DOT_CLASS,
  HEALTH_LABEL,
  HEALTH_TEXT_CLASS,
  getProjectMeta,
} from "@/components/projects/local-meta";
import { PriorityGlyph } from "@/components/projects/priority-glyph";
import { ProgressBar } from "@/components/projects/progress-bar";
import type {
  AgentStatus,
  Project,
  ProjectStats,
  Task,
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

const TASK_STATE_DOT: Record<Task["state"], string> = {
  todo: "bg-muted-foreground",
  running: "bg-status-active",
  review: "bg-status-queued",
  done: "bg-status-completed",
  failed: "bg-status-failed",
  canceled: "bg-muted",
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
  const [agents, setAgents] = useState<AgentStatus[]>([]);
  const { lastMessage } = useWebSocket();

  const meta = getProjectMeta(project.id);
  const accent = project.color || "#6b7280";
  const pct = stats.total > 0 ? (stats.done / stats.total) * 100 : 0;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = await api.agents.list();
        if (!cancelled) setAgents(list);
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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

  // Filter agents to those that have any session in this project (best effort:
  // since AgentStatus.sessions only carries an issueKey, we just show all agents
  // that have at least one session — backend lacks per-project agent join).
  const projectAgents = agents.filter((a) => a.activeSessions + a.idleSessions > 0);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <header className="border-b border-border px-6 py-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div
              className="size-10 shrink-0 rounded-md"
              style={{ backgroundColor: accent }}
              aria-hidden
            />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="truncate text-[18px] font-semibold tracking-tight">
                  {project.name}
                </h1>
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
                    HEALTH_TEXT_CLASS[meta.health],
                  )}
                >
                  <span className={cn("size-1.5 rounded-full", HEALTH_DOT_CLASS[meta.health])} />
                  {HEALTH_LABEL[meta.health]}
                </span>
              </div>
              <p className="mt-1 max-w-2xl text-[13px] text-muted-foreground">
                {project.description || "No description"}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1">
                  <PriorityGlyph priority={meta.priority} />
                  Priority
                </span>
                <span>
                  Lead: <span className="text-foreground">{meta.lead ?? "—"}</span>
                </span>
                <span>
                  Target: <span className="text-foreground">{meta.targetDate ?? "—"}</span>
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
            <Link href="/projects">
              <Button size="sm" variant="outline" className="h-8">
                Back
              </Button>
            </Link>
          </div>
        </div>

        {/* Progress strip */}
        <div className="mt-4 flex items-center gap-4">
          <ProgressBar value={pct} />
          <span className="text-[11px] text-muted-foreground">
            {stats.done} of {stats.total} tasks done · {fmtUsd(stats.totalCostUsd)} spent
          </span>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-auto">
        {/* Overview / milestones */}
        <Section title="Overview">
          <div className="rounded-lg border border-dashed border-border bg-card/40 p-6">
            <p className="text-[13px] text-muted-foreground">No milestones yet.</p>
            <button
              type="button"
              className="mt-2 inline-flex items-center gap-1.5 text-[12px] text-muted-foreground hover:text-foreground"
            >
              <PlusIcon />
              Add milestone
            </button>
          </div>
        </Section>

        {/* Assigned agents */}
        <Section title="Assigned agents">
          {projectAgents.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">No agents currently working on this project.</p>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {projectAgents.map((a) => (
                <div
                  key={a.role}
                  className="rounded-lg border border-border bg-card p-4"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="flex size-6 items-center justify-center rounded-full bg-accent text-[11px] font-medium">
                        {a.name.slice(0, 1)}
                      </span>
                      <span className="text-[13px] font-medium">{a.name}</span>
                    </div>
                    <span
                      className={cn(
                        "rounded-full px-1.5 py-0.5 text-[10px]",
                        a.hasCapacity ? "bg-status-active/15 text-status-active" : "bg-muted text-muted-foreground",
                      )}
                    >
                      {a.hasCapacity ? "available" : "busy"}
                    </span>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-[11px] text-muted-foreground">
                    <Stat label="Active" value={a.activeSessions} />
                    <Stat label="Idle" value={a.idleSessions} />
                    <Stat label="Cap" value={a.maxConcurrency} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* Active tasks */}
        <Section title="Tasks">
          <div className="overflow-hidden rounded-lg border border-border">
            {recentTasks.length === 0 ? (
              <div className="p-6 text-center text-[13px] text-muted-foreground">
                No tasks yet.{" "}
                <Link href={newTaskHref} className="text-foreground underline">
                  Create one
                </Link>
                .
              </div>
            ) : (
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-2 font-medium">Title</th>
                    <th className="px-4 py-2 font-medium">State</th>
                    <th className="px-4 py-2 font-medium">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {recentTasks.map((task) => (
                    <tr
                      key={task.id}
                      className="border-b border-border/60 last:border-b-0 hover:bg-accent/40"
                    >
                      <td className="px-4 py-2">
                        <Link
                          href={`/tasks?task=${encodeURIComponent(task.id)}`}
                          className="block truncate"
                        >
                          {task.title}
                        </Link>
                      </td>
                      <td className="px-4 py-2">
                        <span className="inline-flex items-center gap-1.5 text-[12px]">
                          <span className={cn("size-1.5 rounded-full", TASK_STATE_DOT[task.state])} />
                          {task.state}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-[11px] text-muted-foreground">
                        {formatRelativeTime(task.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </Section>
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
    <section className="border-b border-border px-6 py-5 last:border-b-0">
      <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="font-mono text-[13px] text-foreground">{value}</div>
      <div className="text-[10px] uppercase">{label}</div>
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
