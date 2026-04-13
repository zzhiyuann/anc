"use client";

/**
 * DispatchTaskDialog — quick task creation pre-assigned to a single agent role.
 *
 * Used from the /members table and the /agents/[role] header. Wraps
 * `api.tasks.create({ agent: role })`, which the backend honors by spawning a
 * session for that role on the new task. The optimistic redirect lands the
 * user on the new task in /tasks.
 */

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface DispatchTaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  role: string;
  roleName: string;
  /** Called after a successful dispatch (used to refresh the parent view). */
  onDispatched?: (taskId: string) => void;
}

const PRIORITIES = [
  { value: 1, label: "CEO (P1)" },
  { value: 2, label: "Urgent (P2)" },
  { value: 3, label: "Normal (P3)" },
  { value: 4, label: "Low (P4)" },
] as const;

export function DispatchTaskDialog({
  open,
  onOpenChange,
  role,
  roleName,
  onDispatched,
}: DispatchTaskDialogProps) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<number>(3);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setTitle("");
    setDescription("");
    setPriority(3);
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setError("Title is required.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await api.tasks.create({
        title: title.trim(),
        description: description.trim() || undefined,
        agent: role,
        priority,
      });
      const taskId =
        (res as unknown as { task?: { id?: string }; issueKey?: string }).task
          ?.id ??
        (res as unknown as { issueKey?: string }).issueKey ??
        "";
      onDispatched?.(taskId);
      reset();
      onOpenChange(false);
      if (taskId) router.push(`/tasks?task=${encodeURIComponent(taskId)}`);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(`${err.status}: ${err.message}`);
      } else {
        setError((err as Error).message);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Dispatch task to {roleName}</DialogTitle>
          <DialogDescription>
            Creates a new task pre-assigned to{" "}
            <span className="font-mono">@{role}</span>. The agent will spawn
            immediately if it has capacity.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <Field label="Title">
            <Input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What should they do?"
            />
          </Field>

          <Field label="Context (optional)">
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Background, constraints, links…"
              rows={4}
              className="resize-y font-mono text-[13px]"
            />
          </Field>

          <Field label="Priority">
            <div className="flex flex-wrap gap-1.5">
              {PRIORITIES.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => setPriority(p.value)}
                  className={`rounded-md border px-2 py-1 text-[12px] transition ${
                    priority === p.value
                      ? "border-foreground bg-foreground/10"
                      : "border-border bg-secondary/30 hover:bg-secondary/60"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </Field>

          {error && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-[12px] text-amber-300">
              {error}
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting || !title.trim()}>
              {submitting ? "Dispatching…" : "Dispatch"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      {children}
    </label>
  );
}
