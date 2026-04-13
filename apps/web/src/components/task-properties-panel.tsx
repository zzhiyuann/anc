"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { agentInitial } from "@/lib/utils";
import { api } from "@/lib/api";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { ProjectPicker } from "@/components/project-picker";
import { CostCard } from "@/components/task-detail/CostCard";
import { MemoryTrailCard } from "@/components/task-detail/MemoryTrailCard";
import { ActivityTimeline } from "@/components/task-detail/ActivityTimeline";
import { roleAvatarClass } from "@/components/task-detail/role-colors";
import type {
  AgentStatus,
  ProjectWithStats,
  Task,
  TaskEntityState,
  TaskFull,
} from "@/lib/types";
import type { LabelEntity } from "@/lib/api";

const STATE_OPTIONS: Array<{
  state: TaskEntityState;
  label: string;
  ringClass: string;
  fillClass: string;
  textClass: string;
}> = [
  { state: "todo", label: "Todo", ringClass: "border-muted-foreground/60", fillClass: "bg-transparent", textClass: "text-muted-foreground" },
  { state: "running", label: "Running", ringClass: "border-status-active", fillClass: "bg-status-active/40", textClass: "text-status-active" },
  { state: "review", label: "Review", ringClass: "border-status-queued", fillClass: "bg-status-queued/40", textClass: "text-status-queued" },
  { state: "done", label: "Done", ringClass: "border-status-completed", fillClass: "bg-status-completed", textClass: "text-status-completed" },
  { state: "failed", label: "Failed", ringClass: "border-status-failed", fillClass: "bg-status-failed", textClass: "text-status-failed" },
  { state: "canceled", label: "Canceled", ringClass: "border-muted-foreground/30", fillClass: "bg-transparent", textClass: "text-muted-foreground" },
];

const PRIORITY_OPTIONS: Array<{ priority: number; label: string; tone: string }> = [
  { priority: 1, label: "CEO", tone: "text-status-failed" },
  { priority: 2, label: "Urgent", tone: "text-status-failed" },
  { priority: 3, label: "High", tone: "text-status-queued" },
  { priority: 4, label: "Normal", tone: "text-muted-foreground" },
  { priority: 5, label: "Low", tone: "text-muted-foreground/60" },
];


function StateCircle({
  state,
  size = "size-3",
}: {
  state: TaskEntityState;
  size?: string;
}) {
  const meta = STATE_OPTIONS.find((s) => s.state === state) ?? STATE_OPTIONS[0];
  return (
    <span
      className={cn(
        "inline-block shrink-0 rounded-full border-2",
        size,
        meta.ringClass,
        meta.fillClass,
      )}
    />
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[88px_1fr] items-center gap-2 py-1 text-[12px]">
      <div className="text-muted-foreground">{label}</div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function isoToDate(iso: string | null): Date | undefined {
  if (!iso) return undefined;
  // Treat YYYY-MM-DD as local date to avoid TZ shift.
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return undefined;
  return new Date(y, m - 1, d);
}

function dateToIso(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function DueDateRow({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (next: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = isoToDate(value);
  return (
    <Row label="Due">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <button
              type="button"
              className={cn(
                "rounded px-1 py-0.5 text-left text-[12px] hover:bg-accent hover:text-foreground",
                value ? "text-foreground" : "text-muted-foreground/40",
              )}
            >
              {value ?? "—"}
            </button>
          }
        />
        <PopoverContent align="start" className="w-auto p-2">
          <Calendar
            mode="single"
            selected={selected}
            onSelect={(d) => {
              if (d) {
                onChange(dateToIso(d));
                setOpen(false);
              }
            }}
            initialFocus
          />
          <div className="mt-2 flex justify-between border-t border-border pt-2">
            <button
              type="button"
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
              className="rounded px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              Close
            </button>
          </div>
        </PopoverContent>
      </Popover>
    </Row>
  );
}

function Section({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="shrink-0 border-b border-border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full cursor-pointer items-center justify-between px-4 py-2.5 text-left transition-colors hover:bg-accent/50"
      >
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </h3>
        <svg
          viewBox="0 0 16 16"
          className={cn(
            "size-2.5 text-muted-foreground transition-transform",
            open && "rotate-90",
          )}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M6 4l4 4-4 4" />
        </svg>
      </button>
      {open && <div className="px-4 pb-3">{children}</div>}
    </section>
  );
}

interface TaskPropertiesPanelProps {
  data: TaskFull;
  projects: ProjectWithStats[];
  onUpdated?: (patch: Partial<Task>) => void;
}

export function TaskPropertiesPanel({
  data,
  projects,
  onUpdated,
}: TaskPropertiesPanelProps) {
  const [task, setTask] = useState<Task>(data.task);
  const [agents, setAgents] = useState<AgentStatus[]>([]);
  const [labelMenuOpen, setLabelMenuOpen] = useState(false);
  const [labelCatalog, setLabelCatalog] = useState<LabelEntity[]>([]);
  const [newLabel, setNewLabel] = useState("");

  useEffect(() => {
    setTask(data.task);
  }, [data.task]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [agentList, labelList] = await Promise.all([
          api.agents.list(),
          api.labels.list(),
        ]);
        if (cancelled) return;
        setAgents(agentList);
        setLabelCatalog(labelList);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshLabelCatalog = async () => {
    try {
      const list = await api.labels.list();
      setLabelCatalog(list);
    } catch {
      /* ignore */
    }
  };

  const project = task.projectId
    ? projects.find((p) => p.id === task.projectId)
    : null;

  const stateMeta =
    STATE_OPTIONS.find((s) => s.state === task.state) ?? STATE_OPTIONS[0];
  const priorityMeta =
    PRIORITY_OPTIONS.find((p) => p.priority === task.priority) ??
    PRIORITY_OPTIONS[3];

  // Derive "time in status" from task:state-changed events.
  const timeInStatus = useMemo(() => {
    const changes = data.events
      .filter((e) => e.type === "task:state-changed")
      .sort((a, b) => a.createdAt - b.createdAt);
    if (changes.length === 0) {
      const ageMs = Date.now() - task.createdAt;
      return [{ state: task.state, ms: ageMs }];
    }
    const buckets: Record<string, number> = {};
    let prevTs = task.createdAt;
    let prevState: string = task.state;
    for (const c of changes) {
      const p = (c.payload as Record<string, unknown> | null) ?? {};
      const from = typeof p.from === "string" ? p.from : prevState;
      buckets[from] = (buckets[from] ?? 0) + (c.createdAt - prevTs);
      prevTs = c.createdAt;
      prevState = typeof p.to === "string" ? p.to : prevState;
    }
    buckets[prevState] = (buckets[prevState] ?? 0) + (Date.now() - prevTs);
    return Object.entries(buckets).map(([state, ms]) => ({ state, ms }));
  }, [data.events, task.state, task.createdAt]);

  const formatDuration = (ms: number): string => {
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h`;
    return `${Math.floor(h / 24)}d`;
  };

  const apply = async (patch: Partial<Task>) => {
    setTask((prev) => ({ ...prev, ...patch }));
    onUpdated?.(patch);
    try {
      await api.tasks.update(task.id, patch);
    } catch {
      /* optimistic — keep UI; backend may not honor every field */
    }
  };

  const labels = task.labels ?? [];
  const allLabels = useMemo(() => {
    const s = new Set<string>();
    for (const l of labelCatalog) s.add(l.name);
    for (const l of labels) s.add(l);
    return [...s].sort();
  }, [labelCatalog, labels]);

  const handleCreateLabel = async () => {
    const name = newLabel.trim();
    if (!name) return;
    try {
      const created = await api.labels.create(name);
      setNewLabel("");
      if (created) {
        await refreshLabelCatalog();
        void apply({ labels: [...labels, created.name] });
      } else {
        // Backend offline — still apply locally so the UI moves.
        void apply({ labels: [...labels, name] });
      }
    } catch {
      void apply({ labels: [...labels, name] });
    }
  };

  return (
    <aside className="flex h-full w-full flex-col overflow-y-auto border-l border-border bg-background">
      {/* Properties */}
      <section className="shrink-0 border-b border-border px-4 pb-3 pt-3">
        <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Properties
        </h3>

        {/* Status */}
        <Row label="Status">
          <DropdownMenu>
            <DropdownMenuTrigger
              className="group flex items-center gap-1.5 rounded px-1 py-0.5 hover:bg-accent"
              title={`Time in ${stateMeta.label.toLowerCase()}: ${
                timeInStatus.find((t) => t.state === task.state)?.ms
                  ? formatDuration(
                      timeInStatus.find((t) => t.state === task.state)!.ms,
                    )
                  : "—"
              }`}
            >
              <StateCircle state={task.state} />
              <span className={cn("font-medium", stateMeta.textClass)}>
                {stateMeta.label}
              </span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {STATE_OPTIONS.map((opt) => (
                <DropdownMenuItem
                  key={opt.state}
                  onClick={() => void apply({ state: opt.state })}
                  className="gap-2"
                >
                  <span
                    className={cn(
                      "size-3 rounded-full border-2",
                      opt.ringClass,
                      opt.fillClass,
                    )}
                  />
                  <span className={opt.textClass}>{opt.label}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </Row>

        {/* Priority */}
        <Row label="Priority">
          <DropdownMenu>
            <DropdownMenuTrigger className="rounded px-1 py-0.5 hover:bg-accent">
              <span className={cn("font-medium", priorityMeta.tone)}>
                {priorityMeta.label}
              </span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" sideOffset={4}>
              {PRIORITY_OPTIONS.map((opt) => (
                <DropdownMenuItem
                  key={opt.priority}
                  onClick={() => void apply({ priority: opt.priority })}
                >
                  <span className={cn("font-medium", opt.tone)}>{opt.label}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </Row>

        {/* Assignee */}
        <Row label="Assignee">
          <DropdownMenu>
            <DropdownMenuTrigger className="flex items-center gap-1.5 rounded px-1 py-0.5 hover:bg-accent">
              {task.assignee ? (
                <>
                  <span
                    className={cn(
                      "flex size-4 items-center justify-center rounded-full text-[9px] font-semibold",
                      roleAvatarClass(task.assignee),
                    )}
                  >
                    {agentInitial(task.assignee)}
                  </span>
                  <span className="capitalize">{task.assignee}</span>
                </>
              ) : (
                <span className="text-muted-foreground">Unassigned</span>
              )}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem
                onClick={() => void apply({ assignee: null })}
                className="text-muted-foreground"
              >
                Unassigned
              </DropdownMenuItem>
              {(agents.length > 0 ? agents : [{ role: "engineer" }, { role: "strategist" }, { role: "ops" }] as AgentStatus[]).map((a) => (
                <DropdownMenuItem
                  key={a.role}
                  onClick={() => void apply({ assignee: a.role })}
                  className="gap-2"
                >
                  <span
                    className={cn(
                      "flex size-4 items-center justify-center rounded-full text-[9px] font-semibold",
                      roleAvatarClass(a.role),
                    )}
                  >
                    {agentInitial(a.role)}
                  </span>
                  <span className="capitalize">{a.role}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </Row>

        {/* Labels */}
        <Row label="Labels">
          <div className="relative">
            <button
              type="button"
              onClick={() => setLabelMenuOpen((v) => !v)}
              className="flex flex-wrap items-center gap-1 rounded px-1 py-0.5 hover:bg-accent"
            >
              {labels.length === 0 ? (
                <span className="text-muted-foreground">None</span>
              ) : (
                labels.map((l) => (
                  <span
                    key={l}
                    className="rounded bg-secondary px-1.5 py-0.5 text-[10px]"
                  >
                    {l}
                  </span>
                ))
              )}
            </button>
            {labelMenuOpen && (
              <div className="absolute left-0 top-full z-30 mt-1 w-52 overflow-hidden rounded-md border border-border bg-popover py-1 shadow-md">
                <div className="max-h-48 overflow-y-auto">
                  {allLabels.length === 0 && (
                    <p className="px-2 py-1 text-[11px] text-muted-foreground">
                      No labels yet — create one below.
                    </p>
                  )}
                  {allLabels.map((l) => {
                    const checked = labels.includes(l);
                    return (
                      <button
                        key={l}
                        type="button"
                        onClick={() => {
                          const next = checked
                            ? labels.filter((x) => x !== l)
                            : [...labels, l];
                          void apply({ labels: next });
                        }}
                        className="flex w-full items-center justify-between px-2 py-1 text-left text-[12px] hover:bg-accent"
                      >
                        <span>{l}</span>
                        {checked && <span>✓</span>}
                      </button>
                    );
                  })}
                </div>
                <div className="border-t border-border p-1">
                  <div className="flex items-center gap-1">
                    <input
                      value={newLabel}
                      onChange={(e) => setNewLabel(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void handleCreateLabel();
                        }
                      }}
                      placeholder="Create label…"
                      className="h-6 flex-1 rounded bg-secondary px-1.5 text-[11px] focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                    <button
                      type="button"
                      onClick={() => void handleCreateLabel()}
                      disabled={!newLabel.trim()}
                      className="rounded bg-primary px-1.5 py-0.5 text-[10px] font-medium text-primary-foreground disabled:opacity-40"
                    >
                      Add
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </Row>

        {/* Project */}
        <Row label="Project">
          <ProjectPicker
            value={task.projectId}
            onChange={(id) => void apply({ projectId: id })}
            projects={projects}
            className="w-full"
          />
        </Row>

        {/* Parent */}
        <Row label="Parent">
          {task.parentTaskId ? (
            <Link
              href={`/tasks?task=${encodeURIComponent(task.parentTaskId)}`}
              className="truncate font-mono text-[11px] text-foreground hover:underline"
            >
              {task.parentTaskId}
            </Link>
          ) : (
            <span className="text-muted-foreground/40">—</span>
          )}
        </Row>

        {/* Due date — show single em-dash placeholder, click to edit */}
        <DueDateRow
          value={task.dueDate ?? null}
          onChange={(next) => void apply({ dueDate: next })}
        />

        {/* Cost */}
        <Row label="Cost">
          <span className="font-medium tabular-nums text-foreground">
            ${data.cost.totalUsd.toFixed(2)}
          </span>
        </Row>

        {/* Created */}
        <Row label="Created">
          <span className="text-muted-foreground">
            {new Date(task.createdAt).toLocaleString()}
          </span>
        </Row>
      </section>

      <Section title="Activity">
        <ActivityTimeline events={data.events} />
      </Section>

      <Section title="Cost breakdown">
        <CostCard cost={data.cost} />
      </Section>

      <Section title="Memory trail">
        <MemoryTrailCard events={data.events} />
      </Section>
    </aside>
  );
}
