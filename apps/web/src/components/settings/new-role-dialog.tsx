"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface NewRoleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: () => void;
}

const COLORS = [
  { id: "blue", className: "bg-blue-500" },
  { id: "purple", className: "bg-purple-500" },
  { id: "amber", className: "bg-amber-500" },
  { id: "emerald", className: "bg-emerald-500" },
  { id: "rose", className: "bg-rose-500" },
  { id: "cyan", className: "bg-cyan-500" },
];

const PROTOCOLS = ["coder", "researcher", "operator", "executive"] as const;
type Protocol = (typeof PROTOCOLS)[number];

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

export function NewRoleDialog({ open, onOpenChange, onCreated }: NewRoleDialogProps) {
  const [name, setName] = useState("");
  const [handle, setHandle] = useState("");
  const [color, setColor] = useState("blue");
  const [protocol, setProtocol] = useState<Protocol>("coder");
  const [maxConcurrency, setMaxConcurrency] = useState(3);
  const [dutySlots, setDutySlots] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const effectiveHandle = handle || slugify(name);

  function reset() {
    setName("");
    setHandle("");
    setColor("blue");
    setProtocol("coder");
    setMaxConcurrency(3);
    setDutySlots(0);
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !effectiveHandle) {
      setError("Display name is required.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await api.agents.createRole({
        role: effectiveHandle,
        name: name.trim(),
        baseProtocol: protocol,
        maxConcurrency,
        dutySlots,
        iconColor: color,
      });
      onCreated?.();
      reset();
      onOpenChange(false);
    } catch (err) {
      if (err instanceof ApiError && (err.status === 404 || err.status === 0)) {
        setError(
          "Backend not wired yet — the parent will finish this. Your role spec is valid.",
        );
      } else {
        setError((err as Error).message);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New role</DialogTitle>
          <DialogDescription>
            Add a new agent role to your company. Personas are composed from a base
            protocol and may be tuned later.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <Field label="Display name">
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Designer"
            />
          </Field>

          <Field label="Handle">
            <Input
              value={effectiveHandle}
              onChange={(e) => setHandle(slugify(e.target.value))}
              placeholder="designer"
            />
          </Field>

          <Field label="Icon color">
            <div className="flex flex-wrap gap-2">
              {COLORS.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setColor(c.id)}
                  className={`size-6 rounded-md ${c.className} ring-offset-2 transition ${
                    color === c.id ? "ring-2 ring-foreground" : ""
                  }`}
                  aria-label={c.id}
                />
              ))}
            </div>
          </Field>

          <Field label="Base protocol">
            <select
              value={protocol}
              onChange={(e) => setProtocol(e.target.value as Protocol)}
              className="h-9 w-full rounded-md border border-border bg-background px-2 text-[13px]"
            >
              {PROTOCOLS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </Field>

          <Field label={`Max concurrency: ${maxConcurrency}`}>
            <input
              type="range"
              min={1}
              max={5}
              value={maxConcurrency}
              onChange={(e) => setMaxConcurrency(Number(e.target.value))}
              className="w-full"
            />
          </Field>

          <Field label={`Duty slots: ${dutySlots}`}>
            <input
              type="range"
              min={0}
              max={3}
              value={dutySlots}
              onChange={(e) => setDutySlots(Number(e.target.value))}
              className="w-full"
            />
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
            <Button type="submit" disabled={submitting}>
              {submitting ? "Creating…" : "Create role"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      {children}
    </label>
  );
}
