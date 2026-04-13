"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import type { Objective } from "@/lib/types";

const CURRENT_QUARTER = "2026 Q2";

export function OkrsCard() {
  const [objectives, setObjectives] = useState<Objective[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    let aborted = false;
    api.pulse
      .listObjectives(CURRENT_QUARTER)
      .then((res) => {
        if (!aborted) setObjectives(res);
      })
      .catch(() => {
        if (!aborted) setObjectives([]);
      })
      .finally(() => {
        if (!aborted) setLoading(false);
      });
    return () => {
      aborted = true;
    };
  }, []);

  const handleCreate = async () => {
    if (!draft.trim()) return;
    try {
      const obj = await api.pulse.createObjective({
        title: draft.trim(),
        quarter: CURRENT_QUARTER,
      });
      setObjectives((prev) => [obj, ...prev]);
      setDraft("");
      setOpen(false);
      toast.success("Objective added");
    } catch {
      toast.error("Could not create objective");
    }
  };

  return (
    <section className="rounded-xl border border-border bg-card">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <div>
          <h2 className="text-[14px] font-semibold tracking-tight">OKRs</h2>
          <p className="text-[11px] text-muted-foreground">{CURRENT_QUARTER}</p>
        </div>
        <button
          onClick={() => setOpen(true)}
          className="rounded-md border border-border bg-secondary/50 px-2.5 py-1 text-[11px] text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          + Add objective
        </button>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>New objective</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <Input
                placeholder="e.g. Ship the Pulse command center"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                autoFocus
              />
              <p className="text-[11px] text-muted-foreground">
                Quarter: {CURRENT_QUARTER}
              </p>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleCreate}
                disabled={!draft.trim()}
              >
                Create
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </header>

      <div className="divide-y divide-border/60">
        {loading && (
          <div className="px-4 py-6 text-[13px] text-muted-foreground">
            Loading…
          </div>
        )}
        {!loading && objectives.length === 0 && (
          <div className="px-4 py-8 text-center">
            <p className="text-[13px] font-medium">No objectives yet</p>
            <p className="text-[11px] text-muted-foreground">
              Add one to start tracking the quarter.
            </p>
          </div>
        )}
        {objectives.map((o) => (
          <div key={o.id} className="px-4 py-3">
            <h3 className="text-[13px] font-semibold">{o.title}</h3>
            {o.keyResults.length === 0 && (
              <p className="mt-1 text-[11px] text-muted-foreground">
                No key results yet.
              </p>
            )}
            <div className="mt-2 space-y-2">
              {o.keyResults.map((kr) => {
                const pct =
                  kr.target > 0
                    ? Math.min(100, (kr.current / kr.target) * 100)
                    : 0;
                return (
                  <div key={kr.id}>
                    <div className="flex items-baseline justify-between text-[12px]">
                      <span className="truncate">{kr.title}</span>
                      <span className="ml-2 flex-shrink-0 font-mono text-[11px] text-muted-foreground">
                        {kr.current} / {kr.target} {kr.metric}
                      </span>
                    </div>
                    <div className="mt-1 h-1 overflow-hidden rounded-full bg-secondary">
                      <div
                        className="h-full bg-primary"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
