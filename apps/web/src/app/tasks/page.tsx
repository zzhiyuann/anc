"use client";

import { useState } from "react";
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
import { mockTasks } from "@/lib/mock-data";
import type { TaskStatus } from "@/lib/types";

const columns: { key: TaskStatus; label: string; color: string }[] = [
  { key: "backlog", label: "Backlog", color: "text-muted-foreground" },
  { key: "todo", label: "Todo", color: "text-status-queued" },
  { key: "in_progress", label: "In Progress", color: "text-status-active" },
  { key: "in_review", label: "In Review", color: "text-status-suspended" },
  { key: "done", label: "Done", color: "text-status-completed" },
];

export default function TasksPage() {
  const [dialogOpen, setDialogOpen] = useState(false);

  const tasksByStatus = columns.map((col) => ({
    ...col,
    tasks: mockTasks.filter((t) => t.status === col.key),
  }));

  return (
    <div className="flex h-full flex-col p-6">
      {/* Page header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Tasks</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {mockTasks.length} tasks across all stages
          </p>
        </div>
        <Button size="sm" className="gap-1.5" onClick={() => setDialogOpen(true)}>
          <svg className="size-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M8 3v10M3 8h10" />
          </svg>
          New Task
        </Button>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Task</DialogTitle>
              <DialogDescription>
                Create a new task and optionally assign it to an agent.
              </DialogDescription>
            </DialogHeader>
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                setDialogOpen(false);
              }}
            >
              <div>
                <label className="mb-1.5 block text-sm font-medium">Title</label>
                <Input placeholder="Task title..." />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium">
                  Description
                </label>
                <Textarea
                  placeholder="Describe the task..."
                  rows={3}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1.5 block text-sm font-medium">Agent</label>
                  <select className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
                    <option value="">Unassigned</option>
                    <option value="engineer">Engineer</option>
                    <option value="strategist">Strategist</option>
                    <option value="ops">Ops</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium">
                    Priority
                  </label>
                  <select className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
                    <option value="none">None</option>
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setDialogOpen(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" size="sm">
                  Create
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Kanban board */}
      <div className="flex flex-1 gap-4 overflow-x-auto pb-4">
        {tasksByStatus.map((column) => (
          <div
            key={column.key}
            className="flex w-64 shrink-0 flex-col rounded-xl border border-border bg-card/50"
          >
            {/* Column header */}
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

            {/* Task list */}
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
