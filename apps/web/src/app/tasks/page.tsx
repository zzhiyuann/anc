"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Group, Panel, useDefaultLayout } from "react-resizable-panels";
import { TaskListRail } from "@/components/task-list-rail";
import { TaskPropertiesPanel } from "@/components/task-properties-panel";
import { TaskDetailCenter } from "@/components/task-detail-center";
import { ProjectPicker } from "@/components/project-picker";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ResizeHandle } from "@/components/ui/resize-handle";
import { api, ApiError } from "@/lib/api";
import { mockTasks } from "@/lib/mock-data";
import type {
  AgentStatus,
  ProjectWithStats,
  Task,
  TaskFull,
} from "@/lib/types";

const PRIORITY_ITEMS: Array<{ value: number; label: string }> = [
  { value: 1, label: "1 — CEO" },
  { value: 2, label: "2 — Urgent" },
  { value: 3, label: "3 — High" },
  { value: 4, label: "4 — Normal" },
  { value: 5, label: "5 — Low" },
];

const TASKS_PANES_STORAGE_KEY = "anc-tasks-panes";

export default function TasksPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          Loading…
        </div>
      }
    >
      <TasksPageInner />
    </Suspense>
  );
}

function TasksPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedId = searchParams.get("task");
  const initialNew = searchParams.get("new") === "1";
  const presetProjectId = searchParams.get("projectId");

  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<ProjectWithStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [backendError, setBackendError] = useState<string | null>(null);

  const [detail, setDetail] = useState<TaskFull | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [dialogOpen, setDialogOpen] = useState(initialNew);
  const [title, setTitleValue] = useState("");
  const [description, setDescription] = useState("");
  const [agent, setAgent] = useState("engineer");
  const [agentList, setAgentList] = useState<AgentStatus[]>([]);
  const [priority, setPriority] = useState<number>(3);
  const [taskProjectId, setTaskProjectId] = useState<string | null>(presetProjectId);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const refreshList = useCallback(async () => {
    try {
      const next = await api.tasks.list();
      setTasks(next);
      setBackendError(null);
    } catch (err) {
      setTasks(mockTasks);
      setBackendError(
        err instanceof ApiError ? err.message : "Backend unreachable",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshList();
  }, [refreshList]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = await api.projects.list();
        if (!cancelled) setProjects(list);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Load real agent roster for the Create-Task agent picker
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = await api.agents.list();
        if (!cancelled && list.length > 0) {
          setAgentList(list);
          setAgent((cur) => (list.some((a) => a.role === cur) ? cur : list[0].role));
        }
      } catch {
        /* ignore — agent select falls back to the default option */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const tasksLayout = useDefaultLayout({
    id: TASKS_PANES_STORAGE_KEY,
    panelIds: ["list", "center", "properties"],
    storage: typeof window !== "undefined" ? window.localStorage : undefined,
  });

  // Auto-select first task if none selected
  useEffect(() => {
    if (!selectedId && tasks.length > 0 && !loading) {
      const first = tasks[0];
      const params = new URLSearchParams(searchParams.toString());
      params.set("task", first.id);
      router.replace(`/tasks?${params.toString()}`, { scroll: false });
    }
  }, [selectedId, tasks, loading, router, searchParams]);

  // Fetch detail for selected task
  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    setDetailError(null);
    void (async () => {
      try {
        const d = await api.tasks.getFull(selectedId);
        if (!cancelled) setDetail(d);
      } catch (err) {
        if (!cancelled) {
          setDetail(null);
          setDetailError(
            err instanceof ApiError ? err.message : "Failed to load task",
          );
        }
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const handleSelect = useCallback(
    (id: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("task", id);
      router.replace(`/tasks?${params.toString()}`, { scroll: false });
    },
    [router, searchParams],
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await api.tasks.create({
        title,
        description: description || undefined,
        agent,
        priority,
        projectId: taskProjectId,
      });
      setTitleValue("");
      setDescription("");
      setAgent("engineer");
      setPriority(3);
      setDialogOpen(false);
      await refreshList();
      const r = res as { task?: { id?: string }; taskId?: string; issueKey?: string };
      const newId = r.task?.id ?? r.taskId ?? r.issueKey;
      if (typeof newId === "string" && newId) handleSelect(newId);
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : "Failed to create task");
    } finally {
      setSubmitting(false);
    }
  };

  const refreshDetail = useCallback(async () => {
    if (!selectedId) return;
    try {
      const d = await api.tasks.getFull(selectedId);
      setDetail(d);
    } catch {
      /* keep current */
    }
  }, [selectedId]);

  // Optimistic patch — splice into list and detail so the rail's groupings
  // (status, priority, project, assignee, labels) and row glyphs stay in sync
  // with whatever the user just changed in the properties panel or via inline
  // edits in the center pane. We intentionally do NOT call refreshList() here:
  // the parent panel fires this callback BEFORE its own backend PATCH resolves,
  // so an immediate refresh would race the write and clobber the optimistic
  // state with stale server data. The next manual or websocket-driven refresh
  // will reconcile any server-derived fields.
  const handleTaskPatch = useCallback(
    (id: string, patch: Partial<Task>) => {
      setTasks((prev) =>
        prev.map((t) => (t.id === id ? { ...t, ...patch } : t)),
      );
      setDetail((prev) =>
        prev && prev.task.id === id
          ? { ...prev, task: { ...prev.task, ...patch } }
          : prev,
      );
    },
    [],
  );

  const handleSelectedPatch = useCallback(
    (patch: Partial<Task>) => {
      if (!selectedId) return;
      handleTaskPatch(selectedId, patch);
    },
    [selectedId, handleTaskPatch],
  );

  const live = useMemo(
    () => !backendError && !detailError,
    [backendError, detailError],
  );

  return (
    <>
    <Group
      className="h-full w-full"
      defaultLayout={tasksLayout.defaultLayout}
      onLayoutChanged={tasksLayout.onLayoutChanged}
    >
      <Panel id="list" defaultSize="22%" minSize="15%" maxSize="40%">
        <TaskListRail
          tasks={tasks}
          projects={projects}
          selectedId={selectedId}
          onSelect={handleSelect}
          loading={loading}
          onNewTask={() => setDialogOpen(true)}
          onTasksMutated={refreshList}
        />
      </Panel>

      <ResizeHandle />

      <Panel id="center" minSize="30%">
        <div className="flex h-full min-w-0 flex-col overflow-y-auto">
        {detailLoading && !detail && (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Loading task…
          </div>
        )}
        {detailError && !detail && (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-status-failed">
            <span>Failed to load task · {detailError}</span>
            <button
              type="button"
              onClick={() => {
                if (!selectedId) return;
                setDetailError(null);
                setDetailLoading(true);
                void api.tasks
                  .getFull(selectedId)
                  .then((d) => setDetail(d))
                  .catch((err) =>
                    setDetailError(
                      err instanceof ApiError ? err.message : "Failed to load",
                    ),
                  )
                  .finally(() => setDetailLoading(false));
              }}
              className="rounded border border-status-failed/30 px-2 py-0.5 text-[11px] text-status-failed hover:bg-status-failed/10"
            >
              Retry
            </button>
          </div>
        )}
        {!detailLoading && !detail && !detailError && !selectedId && (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Select a task from the list, or press ⌘N to create one.
          </div>
        )}
        {detail && (
          <TaskDetailCenter
            taskId={detail.task.id}
            data={detail}
            live={live}
            onRefresh={refreshDetail}
            onTaskPatch={handleSelectedPatch}
          />
        )}
        </div>
      </Panel>

      <ResizeHandle />

      <Panel id="properties" defaultSize="20%" minSize="14%" maxSize="35%">
        {detail ? (
          <TaskPropertiesPanel
            data={detail}
            projects={projects}
            onUpdated={handleSelectedPatch}
          />
        ) : (
          <div className="h-full border-l border-border bg-background" />
        )}
      </Panel>
    </Group>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Task</DialogTitle>
            <DialogDescription>
              Spawn a new agent session for a manual task.
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Title</label>
              <Input
                value={title}
                onChange={(e) => setTitleValue(e.target.value)}
                placeholder="Task title..."
                required
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Description</label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe the task..."
                rows={3}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Project</label>
              <ProjectPicker
                value={taskProjectId}
                onChange={setTaskProjectId}
                projects={projects}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium">Agent</label>
                <Select<string>
                  value={agent}
                  onValueChange={(v) => v && setAgent(v)}
                  items={(agentList.length > 0
                    ? agentList.map((a) => a.role)
                    : ["engineer", "strategist", "ops"]
                  ).map((role) => ({
                    value: role,
                    label: role.charAt(0).toUpperCase() + role.slice(1),
                  }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(agentList.length > 0
                      ? agentList.map((a) => a.role)
                      : ["engineer", "strategist", "ops"]
                    ).map((role) => (
                      <SelectItem key={role} value={role}>
                        {role.charAt(0).toUpperCase() + role.slice(1)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium">Priority</label>
                <Select<number>
                  value={priority}
                  onValueChange={(v) => v != null && setPriority(v)}
                  items={PRIORITY_ITEMS}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PRIORITY_ITEMS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {submitError && <p className="text-sm text-status-failed">{submitError}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setDialogOpen(false)}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={submitting || !title.trim()}>
                {submitting ? "Creating..." : "Create"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
