"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
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
import { cn } from "@/lib/utils";
import type { AgentStatus } from "@/lib/types";

const PRESET_COLORS = [
  "#7c3aed", // violet
  "#0ea5e9", // sky
  "#10b981", // emerald
  "#f59e0b", // amber
  "#ef4444", // red
  "#ec4899", // pink
  "#14b8a6", // teal
  "#6366f1", // indigo
];

interface NewProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after a project is created (before navigation). */
  onCreated?: (projectId: string) => void;
  /** When true, do not navigate after create — just close. */
  noNavigate?: boolean;
}

// Minimal markdown preview: renders bold/italic/inline code/headings/lists.
// Avoids pulling in a full markdown library for v1.
function renderPreview(src: string): string {
  if (!src) return "";
  const escape = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const lines = src.split(/\r?\n/);
  const out: string[] = [];
  let inList = false;
  for (const raw of lines) {
    const line = escape(raw);
    if (/^\s*-\s+/.test(line)) {
      if (!inList) {
        out.push("<ul class='list-disc pl-5 space-y-0.5'>");
        inList = true;
      }
      out.push(`<li>${inline(line.replace(/^\s*-\s+/, ""))}</li>`);
      continue;
    }
    if (inList) {
      out.push("</ul>");
      inList = false;
    }
    if (/^###\s+/.test(line)) {
      out.push(`<h3 class='text-[13px] font-semibold mt-2'>${inline(line.replace(/^###\s+/, ""))}</h3>`);
    } else if (/^##\s+/.test(line)) {
      out.push(`<h2 class='text-[14px] font-semibold mt-2'>${inline(line.replace(/^##\s+/, ""))}</h2>`);
    } else if (/^#\s+/.test(line)) {
      out.push(`<h1 class='text-[15px] font-semibold mt-2'>${inline(line.replace(/^#\s+/, ""))}</h1>`);
    } else if (line.trim() === "") {
      out.push("<p class='h-2'></p>");
    } else {
      out.push(`<p>${inline(line)}</p>`);
    }
  }
  if (inList) out.push("</ul>");
  return out.join("");
}

function inline(s: string): string {
  return s
    .replace(/`([^`]+)`/g, "<code class='rounded bg-muted px-1 py-0.5 text-[11px]'>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");
}

export function NewProjectDialog({
  open,
  onOpenChange,
  onCreated,
  noNavigate = false,
}: NewProjectDialogProps) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState<string>(PRESET_COLORS[0]);
  const [lead, setLead] = useState<string>("");
  const [targetDate, setTargetDate] = useState<string>("");
  const [showPreview, setShowPreview] = useState(false);
  const [agents, setAgents] = useState<AgentStatus[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
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
  }, [open]);

  const reset = () => {
    setName("");
    setDescription("");
    setColor(PRESET_COLORS[0]);
    setLead("");
    setTargetDate("");
    setShowPreview(false);
    setError(null);
  };

  const trimmedName = name.trim();
  const nameValid = trimmedName.length >= 2;
  const colorValid = !!color;
  const canSubmit = nameValid && colorValid && !submitting;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nameValid) {
      setError("Name must be at least 2 characters");
      return;
    }
    if (!colorValid) {
      setError("Pick a color");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const project = await api.projects.create({
        name: trimmedName,
        description: description.trim() || undefined,
        color,
      });
      // Apply optional metadata in a follow-up patch (these aren't part of
      // the create payload contract but are first-class on PATCH).
      const patch: Record<string, unknown> = {};
      if (lead) patch.lead = lead;
      if (targetDate) patch.targetDate = targetDate;
      if (Object.keys(patch).length > 0) {
        try {
          await api.projects.update(project.id, patch as never);
        } catch {
          // non-fatal
        }
      }
      toast.success(`Project "${project.name}" created`);
      onCreated?.(project.id);
      onOpenChange(false);
      reset();
      if (!noNavigate) {
        router.push(`/projects/${project.id}`);
        router.refresh();
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Failed to create project";
      setError(msg);
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) reset();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Project</DialogTitle>
          <DialogDescription>
            Group related tasks under a single project.
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={handleSubmit}>
          {/* Name + colored square preview */}
          <div>
            <label className="mb-1.5 block text-sm font-medium">Name</label>
            <div className="flex items-center gap-2">
              <span
                className="size-7 shrink-0 rounded-md border border-border"
                style={{ backgroundColor: color }}
                aria-hidden
              />
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="My new project"
                required
                autoFocus
              />
            </div>
            {!nameValid && name.length > 0 && (
              <p className="mt-1 text-[11px] text-status-failed">
                Name must be at least 2 characters.
              </p>
            )}
          </div>

          {/* Description with preview toggle */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label className="text-sm font-medium">Description</label>
              <button
                type="button"
                onClick={() => setShowPreview((s) => !s)}
                className="text-[11px] text-muted-foreground hover:text-foreground"
              >
                {showPreview ? "Edit" : "Preview"}
              </button>
            </div>
            {showPreview ? (
              <div
                className="min-h-[64px] rounded-md border border-border bg-card p-3 text-[13px] text-foreground"
                dangerouslySetInnerHTML={{
                  __html:
                    renderPreview(description) ||
                    "<span class='text-muted-foreground'>Nothing to preview</span>",
                }}
              />
            ) : (
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Markdown supported. **bold**, *italic*, `code`, # headings, - lists"
                rows={4}
              />
            )}
          </div>

          {/* Color picker */}
          <div>
            <label className="mb-1.5 block text-sm font-medium">Color</label>
            <div className="flex flex-wrap gap-2">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={cn(
                    "size-7 rounded-md transition-transform hover:scale-110",
                    color === c && "ring-2 ring-offset-2 ring-offset-popover ring-foreground",
                  )}
                  style={{ backgroundColor: c }}
                  aria-label={`Color ${c}`}
                />
              ))}
            </div>
          </div>

          {/* Lead picker */}
          <div>
            <label className="mb-1.5 block text-sm font-medium">Lead (optional)</label>
            <select
              value={lead}
              onChange={(e) => setLead(e.target.value)}
              className="h-9 w-full rounded-md border border-border bg-background px-2 text-[13px]"
            >
              <option value="">Unassigned</option>
              {agents.map((a) => (
                <option key={a.role} value={a.role}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>

          {/* Target date */}
          <div>
            <label className="mb-1.5 block text-sm font-medium">Target date (optional)</label>
            <Input
              type="date"
              value={targetDate}
              onChange={(e) => setTargetDate(e.target.value)}
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
            <Button type="submit" size="sm" disabled={!canSubmit}>
              {submitting ? "Creating…" : "Create Project"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
