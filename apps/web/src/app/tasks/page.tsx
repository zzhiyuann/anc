"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
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
import { api, ApiError } from "@/lib/api";
import { mockTasks } from "@/lib/mock-data";
import type {
  ProjectWithStats,
  Task,
  TaskFull,
} from "@/lib/types";

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
      const newId =
        (res as Record<string, unknown>).taskId ??
        (res as Record<string, unknown>).issueKey;
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

  const live = useMemo(() => !backendError, [backendError]);

  return (
    <div className="grid h-full grid-cols-[340px_minmax(0,1fr)_320px]">
      <TaskListRail
        tasks={tasks}
        projects={projects}
        selectedId={selectedId}
        onSelect={handleSelect}
        loading={loading}
        onNewTask={() => setDialogOpen(true)}
      />

      <div className="flex h-full min-w-0 flex-col overflow-y-auto">
        {detailLoading && !detail && (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Loading task…
          </div>
        )}
        {detailError && !detail && (
          <div className="flex h-full items-center justify-center text-sm text-status-failed">
            {detailError}
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
          />
        )}
      </div>

      {detail ? (
        <TaskPropertiesPanel data={detail} projects={projects} />
      ) : (
        <div className="border-l border-border bg-background" />
      )}

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
                <select
                  value={agent}
                  onChange={(e) => setAgent(e.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="engineer">Engineer</option>
                  <option value="strategist">Strategist</option>
                  <option value="ops">Ops</option>
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium">Priority</label>
                <select
                  value={priority}
                  onChange={(e) => setPriority(Number(e.target.value))}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value={1}>1 — CEO</option>
                  <option value={2}>2 — Urgent</option>
                  <option value={3}>3 — Normal</option>
                  <option value={5}>5 — Duty</option>
                </select>
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
    </div>
  );
}
