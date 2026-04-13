"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { agentInitial } from "@/lib/utils";
import { roleAvatarClass } from "@/components/task-detail/role-colors";
import { api } from "@/lib/api";
import type { LabelEntity } from "@/lib/api";
import type {
  AgentStatus,
  ProjectWithStats,
  Task,
  TaskEntityState,
} from "@/lib/types";

// =================== constants & helpers ===================

const STATUS_GROUPS: Array<{
  key: string;
  label: string;
  match: (s: TaskEntityState) => boolean;
}> = [
  { key: "running", label: "In Progress", match: (s) => s === "running" },
  { key: "todo", label: "Todo", match: (s) => s === "todo" },
  { key: "review", label: "In Review", match: (s) => s === "review" },
  { key: "done", label: "Done", match: (s) => s === "done" },
  { key: "canceled", label: "Canceled", match: (s) => s === "canceled" || s === "failed" },
];

const STATE_META: Record<
  TaskEntityState,
  { label: string; ringClass: string; fillClass: string }
> = {
  todo: { label: "Todo", ringClass: "border-muted-foreground/60", fillClass: "bg-transparent" },
  running: { label: "In Progress", ringClass: "border-status-active", fillClass: "bg-status-active/40" },
  review: { label: "In Review", ringClass: "border-status-queued", fillClass: "bg-status-queued/40" },
  done: { label: "Done", ringClass: "border-status-completed", fillClass: "bg-status-completed" },
  failed: { label: "Failed", ringClass: "border-status-failed", fillClass: "bg-status-failed" },
  canceled: { label: "Canceled", ringClass: "border-muted-foreground/30", fillClass: "bg-transparent" },
};

const PRIORITY_META: Record<
  number,
  { label: string; glyph: string; tone: string }
> = {
  1: { label: "CEO", glyph: "!!", tone: "text-status-failed" },
  2: { label: "Urgent", glyph: "!", tone: "text-status-failed" },
  3: { label: "High", glyph: "=", tone: "text-status-queued" },
  4: { label: "Normal", glyph: "·", tone: "text-muted-foreground" },
  5: { label: "Low", glyph: "·", tone: "text-muted-foreground/60" },
};

function relativeShort(ts: number | null | undefined): string {
  if (!ts) return "";
  const diff = Date.now() - ts;
  if (diff < 60_000) return "now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  if (diff < 30 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d`;
  return `${Math.floor(diff / (30 * 86_400_000))}mo`;
}

type GroupKey = "status" | "priority" | "project" | "flat";

const GROUP_LABELS: Record<GroupKey, string> = {
  status: "Status",
  priority: "Priority",
  project: "Project",
  flat: "Flat",
};

type SortKey = "created" | "updated" | "priority" | "title";

const SORT_LABELS: Record<SortKey, string> = {
  created: "Created",
  updated: "Updated",
  priority: "Priority",
  title: "Title",
};

interface MultiFilter {
  status: Set<TaskEntityState>;
  priority: Set<number>;
  assignee: Set<string>;
  projectId: Set<string>;
}

function emptyFilter(): MultiFilter {
  return {
    status: new Set(),
    priority: new Set(),
    assignee: new Set(),
    projectId: new Set(),
  };
}

interface TaskListRailProps {
  tasks: Task[];
  projects: ProjectWithStats[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  loading: boolean;
  onNewTask: () => void;
  // Called after bulk PATCH/DELETE so the parent can refresh its task list
  // and the rail's groupings stay consistent with backend state.
  onTasksMutated?: () => void | Promise<void>;
}

// =================== component ===================

export function TaskListRail({
  tasks,
  projects,
  selectedId,
  onSelect,
  loading,
  onNewTask,
  onTasksMutated,
}: TaskListRailProps) {
  const [query, setQuery] = useState("");
  const [groupBy, setGroupBy] = useState<GroupKey>("status");
  const [sortBy, setSortBy] = useState<SortKey>("created");
  const [sortAsc, setSortAsc] = useState(false);
  const [filter, setFilter] = useState<MultiFilter>(emptyFilter);
  const [groupOpen, setGroupOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  // Multi-select
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const lastClickedRef = useRef<string | null>(null);

  // Filter dropdown popover
  const [filterPopover, setFilterPopover] = useState<
    "status" | "priority" | "assignee" | "project" | null
  >(null);

  const [agents, setAgents] = useState<AgentStatus[]>([]);
  const [labelCatalog, setLabelCatalog] = useState<LabelEntity[]>([]);
  const [bulkMenu, setBulkMenu] = useState<
    "status" | "priority" | "label" | "assign" | null
  >(null);
  const [rowMenuId, setRowMenuId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);

  const searchRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const projectsById = useMemo(() => {
    const m = new Map<string, ProjectWithStats>();
    for (const p of projects) m.set(p.id, p);
    return m;
  }, [projects]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [a, l] = await Promise.all([
          api.agents.list(),
          api.labels.list(),
        ]);
        if (cancelled) return;
        setAgents(a);
        setLabelCatalog(l);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ---- bulk actions ----
  const runBulk = useCallback(
    async (
      verb: string,
      ids: string[],
      mutate: (id: string) => Promise<unknown>,
    ) => {
      if (ids.length === 0) return;
      let ok = 0;
      for (const id of ids) {
        try {
          await mutate(id);
          ok++;
        } catch {
          /* swallow per-item */
        }
      }
      toast.success(`${ok} task${ok === 1 ? "" : "s"} ${verb}`);
      setBulkMenu(null);
      void onTasksMutated?.();
    },
    [onTasksMutated],
  );

  const bulkSetStatus = (state: TaskEntityState) =>
    void runBulk("updated", [...selected], (id) =>
      api.tasks.update(id, { state }),
    );
  const bulkSetPriority = (priority: number) =>
    void runBulk("updated", [...selected], (id) =>
      api.tasks.update(id, { priority }),
    );
  const bulkAddLabel = (name: string) =>
    void runBulk("labeled", [...selected], async (id) => {
      const t = tasks.find((x) => x.id === id);
      const next = Array.from(new Set([...(t?.labels ?? []), name]));
      return api.tasks.update(id, { labels: next });
    });
  const bulkAssign = (role: string | null) =>
    void runBulk("assigned", [...selected], (id) =>
      api.tasks.update(id, { assignee: role }),
    );
  const bulkDelete = async () => {
    const ids = [...selected];
    let ok = 0;
    for (const id of ids) {
      try {
        await api.tasks.remove(id);
        ok++;
      } catch {
        /* skip */
      }
    }
    toast.success(`${ok} task${ok === 1 ? "" : "s"} deleted`);
    setSelected(new Set());
    setConfirmBulkDelete(false);
    void onTasksMutated?.();
  };

  const deleteOne = async (id: string) => {
    try {
      await api.tasks.remove(id);
      toast.success("Task deleted");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to delete task",
      );
    }
    setConfirmDeleteId(null);
    setRowMenuId(null);
    void onTasksMutated?.();
  };

  // ---- filter + sort pipeline ----
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let result = tasks.filter((t) => {
      if (filter.status.size > 0 && !filter.status.has(t.state)) return false;
      if (filter.priority.size > 0 && !filter.priority.has(t.priority))
        return false;
      if (
        filter.assignee.size > 0 &&
        !filter.assignee.has(t.assignee ?? t.createdBy ?? "")
      )
        return false;
      if (
        filter.projectId.size > 0 &&
        !filter.projectId.has(t.projectId ?? "__none__")
      )
        return false;
      if (q) {
        const hay = `${t.title ?? ""} ${t.description ?? ""} ${
          t.linearIssueKey ?? ""
        } ${t.id}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    const cmp = (a: Task, b: Task): number => {
      switch (sortBy) {
        case "title":
          return (a.title ?? "").localeCompare(b.title ?? "");
        case "priority":
          return a.priority - b.priority;
        case "updated":
          return (b.completedAt ?? b.createdAt) - (a.completedAt ?? a.createdAt);
        case "created":
        default:
          return b.createdAt - a.createdAt;
      }
    };
    result = [...result].sort((a, b) => (sortAsc ? -cmp(a, b) : cmp(a, b)));
    return result;
  }, [tasks, filter, query, sortBy, sortAsc]);

  // ---- grouping ----
  const grouped = useMemo(() => {
    if (groupBy === "flat") {
      return [{ key: "all", label: `All`, items: filtered }];
    }
    if (groupBy === "status") {
      return STATUS_GROUPS.map((g) => ({
        key: g.key,
        label: g.label,
        items: filtered.filter((t) => g.match(t.state)),
      })).filter((g) => g.items.length > 0);
    }
    if (groupBy === "priority") {
      const buckets = new Map<number, Task[]>();
      for (const t of filtered) {
        const arr = buckets.get(t.priority) ?? [];
        arr.push(t);
        buckets.set(t.priority, arr);
      }
      return [...buckets.entries()]
        .sort(([a], [b]) => a - b)
        .map(([p, items]) => ({
          key: `p-${p}`,
          label: PRIORITY_META[p]?.label ?? `P${p}`,
          items,
        }));
    }
    // project
    const byProject = new Map<string, Task[]>();
    for (const t of filtered) {
      const k = t.projectId ?? "__none__";
      const arr = byProject.get(k) ?? [];
      arr.push(t);
      byProject.set(k, arr);
    }
    return [...byProject.entries()].map(([k, items]) => ({
      key: `proj-${k}`,
      label:
        k === "__none__"
          ? "No project"
          : projectsById.get(k)?.name ?? "Unknown",
      items,
    }));
  }, [filtered, groupBy, projectsById]);

  // Flat ordered list for keyboard nav
  const flatOrder = useMemo(() => grouped.flatMap((g) => g.items), [grouped]);

  const toggleGroupCollapse = (key: string) => {
    setCollapsedGroups((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  };

  // ---- selection helpers ----
  const handleRowClick = useCallback(
    (id: string, e: React.MouseEvent) => {
      if (e.shiftKey && lastClickedRef.current) {
        const a = flatOrder.findIndex((t) => t.id === lastClickedRef.current);
        const b = flatOrder.findIndex((t) => t.id === id);
        if (a >= 0 && b >= 0) {
          const [lo, hi] = a < b ? [a, b] : [b, a];
          const range = flatOrder.slice(lo, hi + 1).map((t) => t.id);
          setSelected((prev) => {
            const next = new Set(prev);
            for (const x of range) next.add(x);
            return next;
          });
        }
        return;
      }
      if (e.metaKey || e.ctrlKey) {
        setSelected((prev) => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        });
        lastClickedRef.current = id;
        return;
      }
      // plain click → focus & open
      setSelected(new Set());
      lastClickedRef.current = id;
      onSelect(id);
    },
    [flatOrder, onSelect],
  );

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // ---- keyboard nav ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      const inField = tag === "INPUT" || tag === "TEXTAREA";
      if (e.key === "/" && !inField) {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (e.key === "Escape") {
        // Esc in search clears the query and unfocuses.
        if (
          inField &&
          (e.target as HTMLElement | null) === searchRef.current
        ) {
          e.preventDefault();
          setQuery("");
          searchRef.current?.blur();
          return;
        }
        if (selected.size > 0) {
          setSelected(new Set());
          return;
        }
        if (rowMenuId) {
          setRowMenuId(null);
          return;
        }
        if (bulkMenu) {
          setBulkMenu(null);
          return;
        }
      }
      if (e.key === "?" && !inField) {
        // Legend owned by another agent — swallow so it never crashes here.
        return;
      }
      if (inField) return;
      if (flatOrder.length === 0) return;
      const idx = flatOrder.findIndex((t) => t.id === selectedId);

      if (e.key === "j" || e.key === "J") {
        e.preventDefault();
        const next = idx < 0 ? 0 : Math.min(idx + 1, flatOrder.length - 1);
        const id = flatOrder[next].id;
        if (e.shiftKey) {
          setSelected((prev) => new Set(prev).add(id));
        }
        onSelect(id);
        return;
      }
      if (e.key === "k" || e.key === "K") {
        e.preventDefault();
        const next = idx < 0 ? 0 : Math.max(idx - 1, 0);
        const id = flatOrder[next].id;
        if (e.shiftKey) {
          setSelected((prev) => new Set(prev).add(id));
        }
        onSelect(id);
        return;
      }
      if (e.key === "x") {
        if (selectedId) {
          e.preventDefault();
          toggleOne(selectedId);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flatOrder, selectedId, selected, onSelect, rowMenuId, bulkMenu]);

  // ---- filter chip helpers ----
  const toggleStatusFilter = (s: TaskEntityState) => {
    setFilter((f) => {
      const next = new Set(f.status);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return { ...f, status: next };
    });
  };
  const togglePriorityFilter = (p: number) => {
    setFilter((f) => {
      const next = new Set(f.priority);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return { ...f, priority: next };
    });
  };
  const toggleAssigneeFilter = (a: string) => {
    setFilter((f) => {
      const next = new Set(f.assignee);
      if (next.has(a)) next.delete(a);
      else next.add(a);
      return { ...f, assignee: next };
    });
  };
  const toggleProjectFilter = (p: string) => {
    setFilter((f) => {
      const next = new Set(f.projectId);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return { ...f, projectId: next };
    });
  };

  const activeChips = useMemo(() => {
    const out: Array<{ key: string; label: string; clear: () => void }> = [];
    for (const s of filter.status) {
      out.push({
        key: `s-${s}`,
        label: STATE_META[s]?.label ?? s,
        clear: () => toggleStatusFilter(s),
      });
    }
    for (const p of filter.priority) {
      out.push({
        key: `p-${p}`,
        label: PRIORITY_META[p]?.label ?? `P${p}`,
        clear: () => togglePriorityFilter(p),
      });
    }
    for (const a of filter.assignee) {
      out.push({ key: `a-${a}`, label: a, clear: () => toggleAssigneeFilter(a) });
    }
    for (const pj of filter.projectId) {
      const name =
        pj === "__none__" ? "No project" : projectsById.get(pj)?.name ?? pj;
      out.push({ key: `pj-${pj}`, label: name, clear: () => toggleProjectFilter(pj) });
    }
    return out;
  }, [filter, projectsById]);

  const totalShown = filtered.length;

  // ---- render ----
  return (
    <div
      ref={containerRef}
      className="relative flex h-full w-full flex-col border-r border-border bg-background"
    >
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-2.5">
        <div className="flex items-baseline gap-2">
          <h2 className="text-[13px] font-semibold">Tasks</h2>
          <span className="text-[11px] text-muted-foreground">{totalShown}</span>
        </div>
        <div className="relative flex items-center gap-1">
          <button
            type="button"
            onClick={() => {
              setGroupOpen((v) => !v);
              setSortOpen(false);
            }}
            className="rounded px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            title="Group by"
          >
            Group · {GROUP_LABELS[groupBy]}
          </button>
          {groupOpen && (
            <div className="absolute right-12 top-7 z-20 w-32 overflow-hidden rounded-md border border-border bg-popover py-1 shadow-md">
              {(Object.keys(GROUP_LABELS) as GroupKey[]).map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => {
                    setGroupBy(g);
                    setGroupOpen(false);
                  }}
                  className={cn(
                    "flex w-full items-center px-2 py-1 text-left text-[12px] hover:bg-accent",
                    groupBy === g && "text-foreground",
                  )}
                >
                  {GROUP_LABELS[g]}
                </button>
              ))}
            </div>
          )}
          <button
            type="button"
            onClick={() => {
              setSortOpen((v) => !v);
              setGroupOpen(false);
            }}
            className="rounded px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            title="Sort"
          >
            Sort · {SORT_LABELS[sortBy]}
            {sortAsc ? " ↑" : " ↓"}
          </button>
          {sortOpen && (
            <div className="absolute right-6 top-7 z-20 w-32 overflow-hidden rounded-md border border-border bg-popover py-1 shadow-md">
              {(Object.keys(SORT_LABELS) as SortKey[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => {
                    setSortBy(s);
                    setSortOpen(false);
                  }}
                  className={cn(
                    "flex w-full items-center px-2 py-1 text-left text-[12px] hover:bg-accent",
                    sortBy === s && "text-foreground",
                  )}
                >
                  {SORT_LABELS[s]}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setSortAsc((v) => !v)}
                className="flex w-full items-center border-t border-border px-2 py-1 text-left text-[11px] text-muted-foreground hover:bg-accent"
              >
                {sortAsc ? "Ascending" : "Descending"}
              </button>
            </div>
          )}
          <button
            type="button"
            onClick={onNewTask}
            className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label="New task"
            title="New task"
          >
            <svg
              viewBox="0 0 16 16"
              className="size-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M8 3v10M3 8h10" />
            </svg>
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="shrink-0 border-b border-border px-2.5 py-1.5">
        <div className="relative">
          <svg
            className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <circle cx="7" cy="7" r="4" />
            <path d="M10 10l3 3" />
          </svg>
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search tasks…  (/)"
            className="h-7 w-full rounded-md bg-secondary pl-7 pr-2 text-[12px] text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
      </div>

      {/* Filter bar */}
      <div className="relative shrink-0 border-b border-border px-2.5 py-1.5">
        <div className="flex flex-wrap items-center gap-1">
          {(
            [
              ["status", "Status"],
              ["priority", "Priority"],
              ["assignee", "Assignee"],
              ["project", "Project"],
            ] as Array<[
              "status" | "priority" | "assignee" | "project",
              string,
            ]>
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilterPopover((p) => (p === key ? null : key))}
              className={cn(
                "rounded-md border border-dashed border-border px-1.5 py-0.5 text-[10px] text-muted-foreground hover:border-border hover:bg-accent hover:text-foreground",
                filterPopover === key && "border-border bg-accent text-foreground",
              )}
            >
              + {label}
            </button>
          ))}
          {activeChips.map((c) => (
            <span
              key={c.key}
              className="inline-flex items-center gap-1 rounded-md bg-accent px-1.5 py-0.5 text-[10px] text-foreground"
            >
              {c.label}
              <button
                type="button"
                onClick={c.clear}
                className="text-muted-foreground hover:text-foreground"
                aria-label="Remove filter"
              >
                ×
              </button>
            </span>
          ))}
          {activeChips.length > 0 && (
            <button
              type="button"
              onClick={() => setFilter(emptyFilter())}
              className="ml-auto text-[10px] text-muted-foreground hover:text-foreground"
            >
              Clear
            </button>
          )}
        </div>

        {filterPopover && (
          <div className="absolute left-2.5 top-9 z-20 w-48 overflow-hidden rounded-md border border-border bg-popover py-1 shadow-md">
            {filterPopover === "status" && (
              <>
                {(
                  [
                    "todo",
                    "running",
                    "review",
                    "done",
                    "failed",
                    "canceled",
                  ] as TaskEntityState[]
                ).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => toggleStatusFilter(s)}
                    className="flex w-full items-center justify-between px-2 py-1 text-left text-[12px] hover:bg-accent"
                  >
                    <span className="flex items-center gap-2">
                      <span
                        className={cn(
                          "size-3 rounded-full border-2",
                          STATE_META[s].ringClass,
                          STATE_META[s].fillClass,
                        )}
                      />
                      {STATE_META[s].label}
                    </span>
                    {filter.status.has(s) && <span>✓</span>}
                  </button>
                ))}
              </>
            )}
            {filterPopover === "priority" && (
              <>
                {[1, 2, 3, 4, 5].map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => togglePriorityFilter(p)}
                    className="flex w-full items-center justify-between px-2 py-1 text-left text-[12px] hover:bg-accent"
                  >
                    <span className={cn("font-medium", PRIORITY_META[p]?.tone)}>
                      {PRIORITY_META[p]?.label ?? `P${p}`}
                    </span>
                    {filter.priority.has(p) && <span>✓</span>}
                  </button>
                ))}
              </>
            )}
            {filterPopover === "assignee" && (
              <>
                {(agents.length > 0
                  ? agents.map((a) => a.role)
                  : ["engineer", "strategist", "ops"]
                ).map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => toggleAssigneeFilter(r)}
                    className="flex w-full items-center justify-between px-2 py-1 text-left text-[12px] hover:bg-accent"
                  >
                    <span className="flex items-center gap-2 capitalize">
                      <span
                        className={cn(
                          "flex size-4 items-center justify-center rounded-full text-[9px] font-semibold",
                          roleAvatarClass(r),
                        )}
                      >
                        {agentInitial(r)}
                      </span>
                      {r}
                    </span>
                    {filter.assignee.has(r) && <span>✓</span>}
                  </button>
                ))}
              </>
            )}
            {filterPopover === "project" && (
              <>
                <button
                  type="button"
                  onClick={() => toggleProjectFilter("__none__")}
                  className="flex w-full items-center justify-between px-2 py-1 text-left text-[12px] hover:bg-accent"
                >
                  <span className="text-muted-foreground">No project</span>
                  {filter.projectId.has("__none__") && <span>✓</span>}
                </button>
                {projects.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => toggleProjectFilter(p.id)}
                    className="flex w-full items-center justify-between px-2 py-1 text-left text-[12px] hover:bg-accent"
                  >
                    <span className="flex items-center gap-2">
                      <span
                        className="size-2 rounded-sm"
                        style={{ backgroundColor: p.color }}
                      />
                      {p.name}
                    </span>
                    {filter.projectId.has(p.id) && <span>✓</span>}
                  </button>
                ))}
              </>
            )}
          </div>
        )}
      </div>

      {/* List */}
      <div
        className="flex-1 overflow-y-auto"
        onClick={(e) => {
          // Click on background closes filter popover
          if (e.target === e.currentTarget) setFilterPopover(null);
        }}
      >
        {loading && (
          <div className="px-4 py-6 text-center text-[11px] text-muted-foreground">
            Loading…
          </div>
        )}
        {!loading && grouped.length === 0 && tasks.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center px-6 text-center">
            <p className="text-[12px] font-medium text-foreground">
              No tasks yet.
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Spawn an agent or queue a manual task to get started.
            </p>
            <button
              type="button"
              onClick={onNewTask}
              className="mt-3 rounded-md bg-primary px-3 py-1 text-[11px] font-medium text-primary-foreground hover:opacity-90"
            >
              + Create your first task
            </button>
          </div>
        )}
        {!loading &&
          grouped.length === 0 &&
          tasks.length > 0 &&
          (activeChips.length > 0 || query.trim().length > 0) && (
            <div className="flex h-full flex-col items-center justify-center px-6 text-center">
              <p className="text-[12px] font-medium text-foreground">
                No tasks match your filters.
              </p>
              <button
                type="button"
                onClick={() => {
                  setFilter(emptyFilter());
                  setQuery("");
                }}
                className="mt-2 rounded-md border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                Clear filters
              </button>
            </div>
          )}
        {grouped.map((g) => {
          const collapsed = collapsedGroups.has(g.key);
          return (
            <div key={g.key}>
              {groupBy !== "flat" && (
                <button
                  type="button"
                  onClick={() => toggleGroupCollapse(g.key)}
                  className="flex w-full items-center gap-1.5 bg-background/95 px-3 py-1 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground"
                >
                  <svg
                    viewBox="0 0 16 16"
                    className={cn(
                      "size-2.5 transition-transform",
                      !collapsed && "rotate-90",
                    )}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M6 4l4 4-4 4" />
                  </svg>
                  {g.label}
                  <span className="text-muted-foreground/60">{g.items.length}</span>
                </button>
              )}
              {!collapsed &&
                g.items.map((t) => {
                  const meta = STATE_META[t.state] ?? STATE_META.todo;
                  const isActive = t.id === selectedId;
                  const isChecked = selected.has(t.id);
                  const project = t.projectId ? projectsById.get(t.projectId) : null;
                  const pri = PRIORITY_META[t.priority] ?? PRIORITY_META[3];
                  // Only show an assignee avatar when an agent has actually
                  // been assigned. Falling back to createdBy was misleading
                  // — every task showed "CEO" even when the engineer was
                  // the real worker. Placeholder ring otherwise.
                  const assignee = t.assignee ?? null;
                  return (
                    <div
                      key={t.id}
                      onClick={(e) => handleRowClick(t.id, e)}
                      className={cn(
                        "group relative flex h-8 cursor-pointer items-center gap-2 px-3 text-[13px]",
                        isActive
                          ? "bg-accent shadow-[inset_2px_0_0_0_var(--primary)]"
                          : "hover:bg-accent/50",
                      )}
                    >
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleOne(t.id);
                        }}
                        aria-label="Select"
                        className={cn(
                          "flex size-3.5 shrink-0 items-center justify-center rounded border transition-opacity",
                          isChecked
                            ? "border-primary bg-primary opacity-100"
                            : "border-border opacity-0 group-hover:opacity-100",
                        )}
                      >
                        {isChecked && (
                          <svg
                            viewBox="0 0 16 16"
                            className="size-2.5 text-primary-foreground"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="3"
                          >
                            <path d="M3 8l3 3 7-7" />
                          </svg>
                        )}
                      </button>
                      <span
                        className={cn(
                          "shrink-0 text-[10px] font-mono tabular-nums",
                          pri.tone,
                        )}
                        title={pri.label}
                      >
                        {pri.glyph}
                      </span>
                      <span
                        className={cn(
                          "size-3 shrink-0 rounded-full border-2",
                          meta.ringClass,
                          meta.fillClass,
                        )}
                        title={meta.label}
                      />
                      <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                        {t.title || "(untitled)"}
                      </span>
                      {t.labels && t.labels.length > 0 && (
                        <span className="hidden shrink-0 items-center gap-0.5 text-[10px] text-muted-foreground sm:inline-flex">
                          {t.labels.slice(0, 2).map((l) => (
                            <span
                              key={l}
                              className="rounded bg-secondary px-1 py-0.5"
                            >
                              {l}
                            </span>
                          ))}
                        </span>
                      )}
                      {project && (
                        <span
                          className="hidden shrink-0 items-center gap-1 rounded px-1 py-0.5 text-[10px] text-muted-foreground sm:inline-flex"
                          title={project.name}
                        >
                          <span
                            className="size-1.5 rounded-sm"
                            style={{ backgroundColor: project.color }}
                          />
                          <span className="max-w-[80px] truncate">
                            {project.name}
                          </span>
                        </span>
                      )}
                      {assignee ? (
                        <span
                          className={cn(
                            "flex size-4 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold",
                            roleAvatarClass(assignee),
                          )}
                          title={assignee}
                        >
                          {agentInitial(assignee)}
                        </span>
                      ) : (
                        <span
                          className="flex size-4 shrink-0 items-center justify-center rounded-full border border-dashed border-muted-foreground/40 text-[9px] text-muted-foreground/50"
                          title="Unassigned"
                        >
                          ·
                        </span>
                      )}
                      <span className="w-7 shrink-0 text-right text-[10px] tabular-nums text-muted-foreground">
                        {relativeShort(t.createdAt)}
                      </span>
                      <div className="relative">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setRowMenuId((cur) => (cur === t.id ? null : t.id));
                          }}
                          aria-label="Row menu"
                          className={cn(
                            "flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-opacity hover:bg-accent hover:text-foreground",
                            rowMenuId === t.id
                              ? "opacity-100"
                              : "opacity-0 group-hover:opacity-100",
                          )}
                        >
                          ⋯
                        </button>
                        {rowMenuId === t.id && (
                          <div
                            className="absolute right-0 top-6 z-30 w-32 overflow-hidden rounded-md border border-border bg-popover py-1 text-[12px] shadow-lg"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              type="button"
                              onClick={() => {
                                onSelect(t.id);
                                setRowMenuId(null);
                              }}
                              className="block w-full px-2 py-1 text-left hover:bg-accent"
                            >
                              Open
                            </button>
                            <button
                              type="button"
                              onClick={async () => {
                                try {
                                  await api.tasks.create({
                                    title: `${t.title || "Untitled"} (copy)`,
                                    description: t.description ?? undefined,
                                    priority: t.priority,
                                    projectId: t.projectId ?? null,
                                  });
                                  toast.success("Task duplicated");
                                } catch {
                                  toast.error("Duplicate failed");
                                }
                                setRowMenuId(null);
                              }}
                              className="block w-full px-2 py-1 text-left hover:bg-accent"
                            >
                              Duplicate
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setConfirmDeleteId(t.id);
                                setRowMenuId(null);
                              }}
                              className="block w-full px-2 py-1 text-left text-status-failed hover:bg-accent"
                            >
                              Delete
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
            </div>
          );
        })}
      </div>

      {/* Multi-select action bar */}
      {selected.size > 0 && (
        <div className="absolute inset-x-2 bottom-2 z-30 rounded-md border border-border bg-popover px-2 py-1.5 text-[11px] shadow-lg">
          <div className="flex items-center gap-2">
            <span className="font-medium text-foreground">
              {selected.size} selected
            </span>
            <span className="text-muted-foreground/40">·</span>

            <BulkMenuButton
              label="Status"
              open={bulkMenu === "status"}
              onToggle={() =>
                setBulkMenu((m) => (m === "status" ? null : "status"))
              }
            >
              {(["todo", "running", "review", "done", "canceled"] as TaskEntityState[]).map(
                (s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => bulkSetStatus(s)}
                    className="flex w-full items-center gap-2 px-2 py-1 text-left text-[12px] hover:bg-accent"
                  >
                    <span
                      className={cn(
                        "size-2.5 rounded-full border-2",
                        STATE_META[s].ringClass,
                        STATE_META[s].fillClass,
                      )}
                    />
                    {STATE_META[s].label}
                  </button>
                ),
              )}
            </BulkMenuButton>

            <BulkMenuButton
              label="Priority"
              open={bulkMenu === "priority"}
              onToggle={() =>
                setBulkMenu((m) => (m === "priority" ? null : "priority"))
              }
            >
              {[1, 2, 3, 4, 5].map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => bulkSetPriority(p)}
                  className={cn(
                    "block w-full px-2 py-1 text-left text-[12px] hover:bg-accent",
                    PRIORITY_META[p]?.tone,
                  )}
                >
                  {PRIORITY_META[p]?.label ?? `P${p}`}
                </button>
              ))}
            </BulkMenuButton>

            <BulkMenuButton
              label="Label"
              open={bulkMenu === "label"}
              onToggle={() =>
                setBulkMenu((m) => (m === "label" ? null : "label"))
              }
            >
              {labelCatalog.length === 0 && (
                <p className="px-2 py-1 text-[11px] text-muted-foreground">
                  No labels — create one in the properties panel.
                </p>
              )}
              {labelCatalog.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => bulkAddLabel(l.name)}
                  className="block w-full px-2 py-1 text-left text-[12px] hover:bg-accent"
                >
                  {l.name}
                </button>
              ))}
            </BulkMenuButton>

            <BulkMenuButton
              label="Assign"
              open={bulkMenu === "assign"}
              onToggle={() =>
                setBulkMenu((m) => (m === "assign" ? null : "assign"))
              }
            >
              <button
                type="button"
                onClick={() => bulkAssign(null)}
                className="block w-full px-2 py-1 text-left text-[12px] text-muted-foreground hover:bg-accent"
              >
                Unassigned
              </button>
              {(agents.length > 0
                ? agents.map((a) => a.role)
                : ["engineer", "strategist", "ops"]
              ).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => bulkAssign(r)}
                  className="flex w-full items-center gap-2 px-2 py-1 text-left text-[12px] capitalize hover:bg-accent"
                >
                  <span
                    className={cn(
                      "flex size-4 items-center justify-center rounded-full text-[9px] font-semibold",
                      roleAvatarClass(r),
                    )}
                  >
                    {agentInitial(r)}
                  </span>
                  {r}
                </button>
              ))}
            </BulkMenuButton>

            <button
              type="button"
              onClick={() => setConfirmBulkDelete(true)}
              className="rounded px-1.5 py-0.5 text-status-failed hover:bg-status-failed/10"
              title="Delete selected"
            >
              ⌫ Delete
            </button>

            <button
              onClick={() => setSelected(new Set())}
              className="ml-auto rounded px-1.5 py-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              title="Clear selection (Esc)"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {/* Single-task delete confirmation */}
      {confirmDeleteId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 p-4"
          onClick={() => setConfirmDeleteId(null)}
        >
          <div
            className="w-72 rounded-lg border border-border bg-popover p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-[13px] font-medium text-foreground">
              Delete this task?
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              This will kill any running sessions and remove it from the queue.
            </p>
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDeleteId(null)}
                className="rounded border border-border px-2 py-1 text-[11px] hover:bg-accent"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void deleteOne(confirmDeleteId)}
                className="rounded bg-status-failed px-2 py-1 text-[11px] font-medium text-white hover:opacity-90"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk delete confirmation */}
      {confirmBulkDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 p-4"
          onClick={() => setConfirmBulkDelete(false)}
        >
          <div
            className="w-72 rounded-lg border border-border bg-popover p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-[13px] font-medium text-foreground">
              Delete {selected.size} task{selected.size === 1 ? "" : "s"}?
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              This cannot be undone.
            </p>
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmBulkDelete(false)}
                className="rounded border border-border px-2 py-1 text-[11px] hover:bg-accent"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void bulkDelete()}
                className="rounded bg-status-failed px-2 py-1 text-[11px] font-medium text-white hover:opacity-90"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function BulkMenuButton({
  label,
  open,
  onToggle,
  children,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="relative">
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          "rounded px-1.5 py-0.5 text-muted-foreground hover:bg-accent hover:text-foreground",
          open && "bg-accent text-foreground",
        )}
      >
        {label} ▾
      </button>
      {open && (
        <div className="absolute bottom-full left-0 mb-1 max-h-64 w-44 overflow-y-auto rounded-md border border-border bg-popover py-1 shadow-lg">
          {children}
        </div>
      )}
    </div>
  );
}
