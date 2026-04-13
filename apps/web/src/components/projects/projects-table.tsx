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
import { cn } from "@/lib/utils";
import type { AgentStatus, ProjectHealth, ProjectWithStats } from "@/lib/types";
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
  | "status";

interface SortState {
  key: SortKey;
  dir: "asc" | "desc";
}

interface Props {
  initialProjects: ProjectWithStats[];
  live: boolean;
}

function progressPct(p: ProjectWithStats): number {
  if (p.stats.total === 0) return 0;
  return (p.stats.done / p.stats.total) * 100;
}

export function ProjectsTable({ initialProjects, live }: Props) {
  const [projects, setProjects] = useState(initialProjects);
  const [search, setSearch] = useState("");
  const [scope, setScope] = useState<"all" | "mine">("all");
  const [showArchived, setShowArchived] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [sort, setSort] = useState<SortState>({ key: "name", dir: "asc" });
  const [agents, setAgents] = useState<AgentStatus[]>([]);
  const { lastMessage } = useWebSocket();

  // Resolve effective meta for a project: prefer backend-provided fields,
  // fall back to legacy localStorage only when the backend response omits
  // them entirely (deprecated fallback path).
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
      if (!showArchived && p.state === "archived") return false;
      if (showArchived && p.state !== "archived") return false;
      if (scope === "mine" && p.createdBy !== "ceo") return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        (p.description ?? "").toLowerCase().includes(q)
      );
    });
  }, [projects, search, scope, showArchived]);

  const rows = useMemo(() => {
    const enriched = filtered.map((p) => ({ project: p, meta: resolveMeta(p) }));
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
        case "status":
          return (progressPct(a.project) - progressPct(b.project)) * dir;
      }
    });
    return enriched;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, sort]);

  const onMetaChange = async (id: string, patch: Partial<ProjectLocalMeta>) => {
    // Optimistic update: patch local state immediately.
    setProjects((prev) =>
      prev.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    );
    try {
      const updated = await api.projects.update(id, patch);
      setProjects((prev) =>
        prev.map((p) => (p.id === id ? { ...p, ...updated } : p)),
      );
    } catch {
      // Revert on failure by re-fetching.
      void refresh();
    }
  };

  const activeCount = projects.filter((p) => p.state !== "archived").length;
  const archivedCount = projects.filter((p) => p.state === "archived").length;

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
            {showArchived ? "Active" : "Archived"}
          </Button>
          <Button size="sm" className="h-8 gap-1.5" onClick={() => setDialogOpen(true)}>
            <PlusIcon />
            New project
          </Button>
        </div>
      </div>

      <div className="px-6 py-2 text-[11px] text-muted-foreground">
        {activeCount} active{archivedCount > 0 && ` · ${archivedCount} archived`}
        {!live && " · mock data (backend offline)"}
      </div>

      {/* Table */}
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full text-[13px]">
          <thead className="sticky top-0 z-10 bg-background">
            <tr className="border-b border-border text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              <Th sort={sort} setSort={setSort} k="name" className="pl-6">
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
              <Th sort={sort} setSort={setSort} k="status" className="pr-6">
                Status
              </Th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-6 py-16 text-center text-sm text-muted-foreground">
                  {showArchived ? "No archived projects." : "No projects yet."}
                </td>
              </tr>
            ) : (
              rows.map(({ project, meta }) => (
                <ProjectRow
                  key={project.id}
                  project={project}
                  meta={meta}
                  agents={agents}
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
  onChange: (patch: Partial<ProjectLocalMeta>) => void;
}

function ProjectRow({ project, meta, agents, onChange }: RowProps) {
  const accent = project.color || "#6b7280";
  const pct = progressPct(project);

  return (
    <tr className="group h-9 border-b border-border/60 transition-colors hover:bg-accent/40">
      {/* Name */}
      <td className="pl-6">
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
