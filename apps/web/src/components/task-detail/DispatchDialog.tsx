"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

interface DispatchDialogProps {
  taskId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDispatched: () => void;
}

const ROLES = ["engineer", "strategist", "ops", "ceo-office"] as const;

export function DispatchDialog({
  taskId,
  open,
  onOpenChange,
  onDispatched,
}: DispatchDialogProps) {
  const [role, setRole] = useState<string>("engineer");
  const [context, setContext] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await api.taskDispatch.dispatch(taskId, role, context || undefined);
      onDispatched();
      onOpenChange(false);
      setContext("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Dispatch failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Dispatch agent</DialogTitle>
          <DialogDescription>
            Attach another agent role to this task. They will share the
            workspace.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium">Agent</label>
            <div className="grid grid-cols-2 gap-2">
              {ROLES.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRole(r)}
                  className={cn(
                    "rounded-md border px-3 py-2 text-left text-sm capitalize transition-colors",
                    role === r
                      ? "border-blue-500 bg-blue-500/10 text-foreground"
                      : "border-border bg-card text-muted-foreground hover:border-border/80",
                  )}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium">
              Context (optional)
            </label>
            <Textarea
              value={context}
              onChange={(e) => setContext(e.target.value)}
              placeholder="Why this agent? What's the handoff?"
              rows={4}
            />
          </div>

          {error && <p className="text-sm text-status-failed">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button size="sm" onClick={submit} disabled={submitting}>
              {submitting ? "Dispatching..." : "Dispatch"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
