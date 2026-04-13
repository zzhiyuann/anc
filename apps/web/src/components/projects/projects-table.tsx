"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NewProjectDialog } from "@/components/new-project-dialog";
import { api } from "@/lib/api";
import { useWebSocket } from "@/lib/use-websocket";
import { cn, formatRelativeTime } from "@/lib/utils";
import type {
  AgentStatus,
  EventRow,
  ProjectHealth,
  ProjectWithStats,
  Task,
} from "@/lib/types";
import {
  ALL_HEALTHS,
  HEALTH_DOT_CLASS,
  HEALTH_LABEL,
  getProjectMeta,
  type ProjectLocalMeta,
} from "./local-meta";
import { PRIORITY_OPTIONS, PriorityGlyph } from "./priority-glyph";
import { ProgressBar } from "./progress-bar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";

// --- Sort columns ---

type SortKey =
  | "name"
  | "health"
  | "priority"
  | "lead"
  | "target"
  | "active"
  | "activity"
  | "status";

interface SortState {
  key: SortKey;
  dir: "asc" | "desc";
}

type ScopeFilter = "all" | "mine" | "my-active";

interface Props {
  initialProjects: ProjectWithStats[];
  live: boolean;
}

interface ProjectActivity {
  /** running / total tasks */
  running: number;
  total: number;
  /** epoch ms of latest event or task createdAt */
  lastActivity: number | null;
}

function progressPct(p: ProjectWithStats): number {
  if (p.stats.total === 0) return 0;
  return (p.stats.done / p.stats.total) * 100;
}

function eventCreatedAtMs(ev: EventRow): number {
  // Backend serves SQLite UTC strings 'YYYY-MM-DD HH:MM:SS'.
  const iso = ev.createdAt.includes("T") ? ev.createdAt : ev.createdAt.replace(" ", "T") + "Z";
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
}

export function ProjectsTable({ initialProjects, live }: Props) {
  const [projects, setProjects] = useState(initialProjects);
  const [search, setSearch] = useState("");
  const [scope, setScope] = useState<ScopeFilter>("all");
  const [showArchived, setShowArchived] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [sort, setSort] = useState<SortState>({ key: "name", dir: "asc" });
  const [agents, setAgents] = useState<AgentStatus[]>([]);
  const [activity, setActivity] = useState<Record<string, ProjectActivity>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const { lastMessage } = useWebSocket();

  const resolveMeta = (p: ProjectWithStats): ProjectLocalMeta => {
    const hasAny =
      p.health !== undefined ||
      p.priority !== undefined ||
      p.lead !== undefined ||
      p.targetDate !== undefined;
    if (hasAny) {
      return {
        health: (p.health ?? "no-update") as ProjectLocalMeta["health"],
        priority: p.priority ?? 3,
        lead: p.lead ?? null,
        targetDate: p.targetDate ?? null,
      };
    }
    return getProjectMeta(p.id);
  };

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

  // Compute per-project activity: running/total + last activity timestamp.
  // Strategy: fetch tasks per project (uses cached listByProject) and the
  // recent events stream, then merge. Backend `/events` does NOT accept a
  // projectId filter — this is the documented gap, see report.
  useEffect(() => {
    let cancelled = false;
    const ids = projects.map((p) => p.id);
    if (ids.length === 0) {
      setActivity({});
      return;
    }
    void (async () => {
      try {
        const [allEvents, ...perProjectTasks] = await Promise.all([
          api.events.list(200).catch(() => [] as EventRow[]),
          ...ids.map((id) =>
            api.tasks.listByProject(id).catch(() => [] as Task[]),
          ),
        ]);
        if (cancelled) return;
        // Build issueKey -> projectId map for event attribution.
        const issueToProject = new Map<string, string>();
        const next: Record<string, ProjectActivity> = {};
        ids.forEach((pid, i) => {
          const tasks = perProjectTasks[i] ?? [];
          let running = 0;
          let lastTaskTs = 0;
          for (const t of tasks) {
            if (t.state === "running") running++;
            if (t.linearIssueKey) issueToProject.set(t.linearIssueKey, pid);
            if (t.createdAt > lastTaskTs) lastTaskTs = t.createdAt;
            if (t.completedAt && t.completedAt > lastTaskTs) lastTaskTs = t.completedAt;
          }
          next[pid] = {
            running,
            total: tasks.length,
            lastActivity: lastTaskTs > 0 ? lastTaskTs : null,
          };
        });
        // Fold in events that mention a known issueKey.
        for (const ev of allEvents) {
          if (!ev.issueKey) continue;
          const pid = issueToProject.get(ev.issueKey);
          if (!pid) continue;
          const ts = eventCreatedAtMs(ev);
          const cur = next[pid];
          if (cur && (!cur.lastActivity || ts > cur.lastActivity)) {
            cur.lastActivity = ts;
          }
        }
        setActivity(next);
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
    // Re-run when project ids change or when WS pings activity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects.map((p) => p.id).join("|"), lastMessage?.ts]);

  useEffect(() => {
    if (!lastMessage) return;
    const t = lastMessage.type;
    if (
      t === "task:created" ||
      t === "task:completed" ||
      t === "agent:spawned" ||
      t === "agent:completed"
    ) {
      void refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastMessage]);

  const refresh = async () => {
    try {
      const next = await api.projects.list();
      setProjects(next);
    } catch {
      // keep current
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return projects.filter((p) => {
      const isArchived = p.state === "archived";
      if (showArchived) {
        // Show archived alongside active.
      } else if (isArchived) {
        return false;
      }
      if (scope === "mine" && p.createdBy !== "ceo") return false;
      if (scope === "my-active") {
        const meta = resolveMeta(p);
        if (meta.lead !== "ceo") return false;
        if (isArchived) return false;
      }
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        (p.description ?? "").toLowerCase().includes(q)
      );
    });
  }, [projects, search, scope, showArchived]);

  const rows = useMemo(() => {
    const enriched = filtered.map((p) => ({
      project: p,
      meta: resolveMeta(p),
      act: activity[p.id] ?? { running: 0, total: p.stats.total, lastActivity: null },
    }));
    enriched.sort((a, b) => {
      const dir = sort.dir === "asc" ? 1 : -1;
      switch (sort.key) {
        case "name":
          return a.project.name.localeCompare(b.project.name) * dir;
        case "health": {
          const order: ProjectHealth[] = ["on-track", "at-risk", "off-track", "no-update"];
          return (order.indexOf(a.meta.health) - order.indexOf(b.meta.health)) * dir;
        }
        case "priority":
          return (a.meta.priority - b.meta.priority) * dir;
        case "lead":
          return ((a.meta.lead ?? "~").localeCompare(b.meta.lead ?? "~")) * dir;
        case "target":
          return ((a.meta.targetDate ?? "9999").localeCompare(b.meta.targetDate ?? "9999")) * dir;
        case "active":
          return (a.act.total - b.act.total) * dir;
        case "activity":
          return ((a.act.lastActivity ?? 0) - (b.act.lastActivity ?? 0)) * dir;
        case "status":
          return (progressPct(a.project) - progressPct(b.project)) * dir;
      }
    });
    return enriched;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, sort, activity]);

  const onMetaChange = async (id: string, patch: Partial<ProjectLocalMeta>) => {
    setProjects((prev) =>
      prev.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    );
    try {
      const updated = await api.projects.update(id, patch);
      setProjects((prev) =>
        prev.map((p) => (p.id === id ? { ...p, ...updated } : p)),
      );
    } catch {
      void refresh();
    }
  };

  const toggleSelected = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected((prev) => {
      if (prev.size === rows.length) return new Set();
      return new Set(rows.map((r) => r.project.id));
    });
  };

  const archiveSelected = async () => {
    if (selected.size === 0) return;
    const ids = Array.from(selected);
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        `Archive ${ids.length} project${ids.length === 1 ? "" : "s"}? This cannot be undone from the bulk bar.`,
      )
    ) {
      return;
    }
    setBulkBusy(true);
    try {
      await Promise.all(
        ids.map((id) =>
          api.projects.update(id, { state: "archived" }).catch(() => null),
        ),
      );
      setSelected(new Set());
      await refresh();
    } finally {
      setBulkBusy(false);
    }
  };

  const activeCount = projects.filter((p) => p.state !== "archived").length;
  const archivedCount = projects.filter((p) => p.state === "archived").length;
  const allChecked = rows.length > 0 && selected.size === rows.length;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 border-b border-border px-6 py-4">
        <div className="flex items-center gap-1">
          <ScopeTab active={scope === "all"} onClick={() => setScope("all")}>
            All projects
          </ScopeTab>
          <ScopeTab active={scope === "mine"} onClick={() => setScope("mine")}>
            My projects
          </ScopeTab>
          <ScopeTab active={scope === "my-active"} onClick={() => setScope("my-active")}>
            My active projects
          </ScopeTab>
        </div>
        <div className="flex items-center gap-2">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter…"
            className="h-8 w-48"
          />
          <Button
            variant={showArchived ? "default" : "outline"}
            size="sm"
            onClick={() => setShowArchived((s) => !s)}
            className="h-8"
          >
            {showArchived ? "Hide archived" : "Show archived"}
          </Button>
          <Button size="sm" className="h-8 gap-1.5" onClick={() => setDialogOpen(true)}>
            <PlusIcon />
            New project
          </Button>
        </div>
      </div>

      <div className="flex items-center justify-between px-6 py-2 text-[11px] text-muted-foreground">
        <span>
          {activeCount} active{archivedCount > 0 && ` · ${archivedCount} archived`}
          {!live && " · mock data (backend offline)"}
        </span>
        {selected.size > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-foreground">{selected.size} selected</span>
            <Button
              size="sm"
              variant="outline"
              className="h-7"
              disabled={bulkBusy}
              onClick={() => setSelected(new Set())}
            >
              Clear
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7"
              disabled={bulkBusy}
              onClick={archiveSelected}
            >
              {bulkBusy ? "Archiving…" : "Archive selected"}
            </Button>
          </div>
        )}
      </div>

      {/* Table */}
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full text-[13px]">
          <thead className="sticky top-0 z-10 bg-background">
            <tr className="border-b border-border text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              <th className="w-8 pl-6">
                <input
                  type="checkbox"
                  checked={allChecked}
                  ref={(el) => {
                    if (el) el.indeterminate = selected.size > 0 && !allChecked;
                  }}
                  onChange={toggleAll}
                  className="size-3.5 cursor-pointer accent-foreground"
                  aria-label="Select all"
                />
              </th>
              <Th sort={sort} setSort={setSort} k="name">
                Name
              </Th>
              <Th sort={sort} setSort={setSort} k="health">
                Health
              </Th>
              <Th sort={sort} setSort={setSort} k="priority">
                Priority
              </Th>
              <Th sort={sort} setSort={setSort} k="lead">
                Lead
              </Th>
              <Th sort={sort} setSort={setSort} k="target">
                Target date
              </Th>
              <Th sort={sort} setSort={setSort} k="active">
                Active tasks
              </Th>
              <Th sort={sort} setSort={setSort} k="activity">
                Last activity
              </Th>
              <Th sort={sort} setSort={setSort} k="status" className="pr-6">
                Status
              </Th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-6 py-16 text-center text-sm text-muted-foreground">
                  {projects.length === 0 ? (
                    <div className="flex flex-col items-center gap-3">
                      <span>No projects yet</span>
                      <Button size="sm" onClick={() => setDialogOpen(true)}>
                        Create your first project
                      </Button>
                    </div>
                  ) : showArchived ? (
                    "No projects match the current filter."
                  ) : (
                    "No projects match the current filter."
                  )}
                </td>
              </tr>
            ) : (
              rows.map(({ project, meta, act }) => (
                <ProjectRow
                  key={project.id}
                  project={project}
                  meta={meta}
                  agents={agents}
                  activity={act}
                  selected={selected.has(project.id)}
                  onToggleSelect={() => toggleSelected(project.id)}
                  onChange={(patch) => onMetaChange(project.id, patch)}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      <NewProjectDialog open={dialogOpen} onOpenChange={setDialogOpen} onCreated={refresh} />
    </div>
  );
}

// --- Header cell with sort indicator ---

function Th({
  k,
  sort,
  setSort,
  children,
  className,
}: {
  k: SortKey;
  sort: SortState;
  setSort: (s: SortState) => void;
  children: React.ReactNode;
  className?: string;
}) {
  const active = sort.key === k;
  return (
    <th
      className={cn(
        "h-9 select-none text-left font-medium",
        className,
      )}
    >
      <button
        type="button"
        onClick={() =>
          setSort({ key: k, dir: active && sort.dir === "asc" ? "desc" : "asc" })
        }
        className={cn(
          "flex items-center gap-1 transition-colors hover:text-foreground",
          active && "text-foreground",
        )}
      >
        {children}
        <span className="inline-block w-2.5 text-[9px]">
          {active ? (sort.dir === "asc" ? "▲" : "▼") : ""}
        </span>
      </button>
    </th>
  );
}

function ScopeTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-md px-3 py-1 text-[13px] font-medium transition-colors",
        active
          ? "bg-accent text-foreground"
          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function PlusIcon() {
  return (
    <svg className="size-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M8 3v10M3 8h10" />
    </svg>
  );
}

// --- Row ---

interface RowProps {
  project: ProjectWithStats;
  meta: ProjectLocalMeta;
  agents: AgentStatus[];
  activity: ProjectActivity;
  selected: boolean;
  onToggleSelect: () => void;
  onChange: (patch: Partial<ProjectLocalMeta>) => void;
}

function ProjectRow({
  project,
  meta,
  agents,
  activity,
  selected,
  onToggleSelect,
  onChange,
}: RowProps) {
  const accent = project.color || "#6b7280";
  const pct = progressPct(project);
  const [hovered, setHovered] = useState(false);

  return (
    <tr
      className={cn(
        "group relative h-9 border-b border-border/60 transition-colors hover:bg-accent/40",
        selected && "bg-accent/30",
      )}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Select */}
      <td className="pl-6">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          onClick={(e) => e.stopPropagation()}
          className="size-3.5 cursor-pointer accent-foreground"
          aria-label={`Select ${project.name}`}
        />
      </td>

      {/* Name (only the name navigates) */}
      <td className="relative">
        <Link
          href={`/projects/${project.id}`}
          className="flex items-center gap-2.5 truncate"
        >
          <span
            className="size-2.5 shrink-0 rounded-[3px]"
            style={{ backgroundColor: accent }}
            aria-hidden
          />
          <span className="truncate font-medium text-foreground">{project.name}</span>
          {project.state === "archived" && (
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
              archived
            </span>
          )}
        </Link>
        {hovered && (
          <div
            role="tooltip"
            className="pointer-events-none absolute left-4 top-full z-20 mt-1 w-72 rounded-md border border-border bg-popover p-3 text-[12px] text-popover-foreground shadow-md"
          >
            <div className="font-medium">{project.name}</div>
            <p className="mt-1 line-clamp-3 text-muted-foreground">
              {project.description || "No description"}
            </p>
            <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
              <span>Lead</span>
              <span className="text-foreground">{meta.lead ?? "—"}</span>
              <span>Tasks</span>
              <span className="text-foreground">
                {activity.running}/{activity.total}
              </span>
              <span>Spent</span>
              <span className="text-foreground">${project.stats.totalCostUsd.toFixed(2)}</span>
              <span>Last activity</span>
              <span className="text-foreground">
                {activity.lastActivity ? formatRelativeTime(activity.lastActivity) : "—"}
              </span>
            </div>
          </div>
        )}
      </td>

      {/* Health */}
      <td>
        <HealthCell value={meta.health} onChange={(v) => onChange({ health: v })} />
      </td>

      {/* Priority */}
      <td>
        <PriorityCell value={meta.priority} onChange={(v) => onChange({ priority: v })} />
      </td>

      {/* Lead */}
      <td>
        <LeadCell value={meta.lead} agents={agents} onChange={(v) => onChange({ lead: v })} />
      </td>

      {/* Target date */}
      <td>
        <TargetDateCell value={meta.targetDate} onChange={(v) => onChange({ targetDate: v })} />
      </td>

      {/* Active tasks */}
      <td>
        <span className="font-mono text-[12px] tabular-nums text-foreground">
          {activity.running}
          <span className="text-muted-foreground">/{activity.total}</span>
        </span>
      </td>

      {/* Last activity */}
      <td className="text-[11px] text-muted-foreground">
        {activity.lastActivity ? formatRelativeTime(activity.lastActivity) : "—"}
      </td>

      {/* Status / progress */}
      <td className="pr-6">
        <ProgressBar value={pct} />
      </td>
    </tr>
  );
}

// --- Inline cells ---

function HealthCell({
  value,
  onChange,
}: {
  value: ProjectHealth;
  onChange: (v: ProjectHealth) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[12px] text-foreground transition-colors hover:bg-accent">
        <span className={cn("size-1.5 rounded-full", HEALTH_DOT_CLASS[value])} />
        {HEALTH_LABEL[value]}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {ALL_HEALTHS.map((h) => (
          <DropdownMenuItem key={h} onClick={() => onChange(h)} className="gap-2">
            <span className={cn("size-1.5 rounded-full", HEALTH_DOT_CLASS[h])} />
            {HEALTH_LABEL[h]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function PriorityCell({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  const label = PRIORITY_OPTIONS.find((p) => p.value === value)?.label ?? `P${value}`;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[12px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
        <PriorityGlyph priority={value} />
        <span>{label}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {PRIORITY_OPTIONS.map((p) => (
          <DropdownMenuItem key={p.value} onClick={() => onChange(p.value)} className="gap-2">
            <PriorityGlyph priority={p.value} />
            {p.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function LeadCell({
  value,
  agents,
  onChange,
}: {
  value: string | null;
  agents: AgentStatus[];
  onChange: (v: string | null) => void;
}) {
  const initial = value ? value.slice(0, 1).toUpperCase() : null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[12px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
        {initial ? (
          <span className="flex size-5 items-center justify-center rounded-full bg-accent text-[10px] font-medium text-foreground">
            {initial}
          </span>
        ) : (
          <span className="flex size-5 items-center justify-center rounded-full border border-dashed border-border text-[10px]">
            +
          </span>
        )}
        <span>{value ?? "—"}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem onClick={() => onChange(null)}>Unassigned</DropdownMenuItem>
        {agents.map((a) => (
          <DropdownMenuItem key={a.role} onClick={() => onChange(a.role)}>
            {a.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function isoToLocalDate(iso: string | null): Date | undefined {
  if (!iso) return undefined;
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return undefined;
  return new Date(y, m - 1, d);
}

function localDateToIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function TargetDateCell({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            className="flex cursor-pointer items-center gap-1.5 rounded px-1.5 py-0.5 text-[12px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <CalendarIcon />
            <span className={value ? "text-foreground" : "text-muted-foreground/60"}>
              {value ?? "—"}
            </span>
          </button>
        }
      />
      <PopoverContent align="start" className="w-auto p-2">
        <Calendar
          mode="single"
          selected={isoToLocalDate(value)}
          onSelect={(d) => {
            if (d) {
              onChange(localDateToIso(d));
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
  );
}

function CalendarIcon() {
  return (
    <svg className="size-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="2" y="3" width="12" height="11" rx="1.5" />
      <path d="M2 6h12M5 1.5v3M11 1.5v3" />
    </svg>
  );
}
