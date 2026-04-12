"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { TaskCard } from "@/components/task-card";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { api, ApiError } from "@/lib/api";
import { mockTasks } from "@/lib/mock-data";
import type { SessionState, TaskRow } from "@/lib/types";

const columns: { key: SessionState; label: string; color: string }[] = [
  { key: "active", label: "Active", color: "text-status-active" },
  { key: "idle", label: "Idle", color: "text-status-idle" },
  { key: "suspended", label: "Suspended", color: "text-status-suspended" },
];

export default function TasksPage() {
  return (
    <Suspense
      fallback={
        <div className="p-6">
          <h1 className="text-xl font-semibold tracking-tight">Tasks</h1>
          <p className="mt-1 text-sm text-muted-foreground">Loading...</p>
        </div>
      }
    >
      <TasksPageInner />
    </Suspense>
  );
}

function TasksPageInner() {
  const searchParams = useSearchParams();
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [backendError, setBackendError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(searchParams.get("new") === "1");

  // Create form state
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [agent, setAgent] = useState("engineer");
  const [priority, setPriority] = useState<number>(3);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
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
    void refresh();
  }, [refresh]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setSubmitError(null);
    try {
      await api.tasks.create({
        title,
        description: description || undefined,
        agent,
        priority,
      });
      setTitle("");
      setDescription("");
      setAgent("engineer");
      setPriority(3);
      setDialogOpen(false);
      await refresh();
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : "Failed to create task");
    } finally {
      setSubmitting(false);
    }
  };

  const tasksByStatus = columns.map((col) => ({
    ...col,
    tasks: tasks.filter((t) => t.state === col.key),
  }));

  return (
    <div className="flex h-full flex-col p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Tasks</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {loading
              ? "Loading..."
              : `${tasks.length} tracked sessions${backendError ? " (mock data — backend offline)" : ""}`}
          </p>
        </div>
        <Button size="sm" className="gap-1.5" onClick={() => setDialogOpen(true)}>
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
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Task title..."
                  required
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium">
                  Description
                </label>
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Describe the task..."
                  rows={3}
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
                  <label className="mb-1.5 block text-sm font-medium">
                    Priority
                  </label>
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
              {submitError && (
                <p className="text-sm text-status-failed">{submitError}</p>
              )}
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

      {/* Kanban board grouped by session state */}
      <div className="flex flex-1 gap-4 overflow-x-auto pb-4">
        {tasksByStatus.map((column) => (
          <div
            key={column.key}
            className="flex w-64 shrink-0 flex-col rounded-xl border border-border bg-card/50"
          >
            <div className="flex items-center justify-between px-3 py-3">
              <div className="flex items-center gap-2">
                <h3 className={`text-sm font-medium ${column.color}`}>
                  {column.label}
                </h3>
                <span className="flex size-5 items-center justify-center rounded-md bg-secondary text-xs text-muted-foreground">
                  {column.tasks.length}
                </span>
              </div>
            </div>

            <ScrollArea className="flex-1 px-2 pb-2">
              <div className="space-y-2">
                {column.tasks.map((task) => (
                  <TaskCard key={task.id} task={task} />
                ))}
                {column.tasks.length === 0 && (
                  <div className="flex h-20 items-center justify-center rounded-lg border border-dashed border-border text-xs text-muted-foreground">
                    No tasks
                  </div>
                )}
              </div>
            </ScrollArea>
          </div>
        ))}
      </div>
    </div>
  );
}
