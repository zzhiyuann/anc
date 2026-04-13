"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { api, ApiError } from "@/lib/api";
import type { KeyResult, Objective } from "@/lib/types";
import {
  addKeyResultRaw,
  createObjectiveRaw,
  listObjectivesRaw,
  PulseError,
  updateKeyResultRaw,
} from "@/components/pulse/pulse-client";

function currentQuarter(d = new Date()): string {
  const q = Math.floor(d.getMonth() / 3) + 1;
  return `${d.getFullYear()} Q${q}`;
}

function previousQuarters(count: number): string[] {
  const out: string[] = [];
  const now = new Date();
  let year = now.getFullYear();
  let q = Math.floor(now.getMonth() / 3) + 1;
  for (let i = 0; i < count + 1; i += 1) {
    out.push(`${year} Q${q}`);
    q -= 1;
    if (q < 1) {
      q = 4;
      year -= 1;
    }
  }
  return out;
}

const QUARTER_OPTIONS = previousQuarters(3);

export function OkrsCard() {
  const [quarter, setQuarter] = useState<string>(currentQuarter());
  const [objectives, setObjectives] = useState<Objective[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftDesc, setDraftDesc] = useState("");
  const [draftQuarter, setDraftQuarter] = useState(quarter);

  // Per-objective KR draft state (kept local for inline form).
  const [krFormFor, setKrFormFor] = useState<string | null>(null);
  const [krTitle, setKrTitle] = useState("");
  const [krMetric, setKrMetric] = useState("");
  const [krTarget, setKrTarget] = useState("");

  // KR optimistic-update busy set.
  const [busyKrs, setBusyKrs] = useState<Set<string>>(new Set());

  const reload = useCallback(
    async (qtr: string) => {
      setLoading(true);
      setError(null);
      try {
        const list = await listObjectivesRaw(qtr);
        setObjectives(list);
      } catch (err) {
        setObjectives([]);
        setError(
          err instanceof PulseError
            ? `Failed to load objectives — ${err.message}`
            : "Failed to load objectives",
        );
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    void reload(quarter);
  }, [quarter, reload]);

  const handleCreate = async () => {
    if (!draftTitle.trim()) return;
    try {
      const obj = await createObjectiveRaw({
        title: draftTitle.trim(),
        description: draftDesc.trim() || undefined,
        quarter: draftQuarter,
      });
      // Only show in the current view if it matches the active quarter.
      if (draftQuarter === quarter) {
        setObjectives((prev) => [obj, ...prev]);
      }
      setDraftTitle("");
      setDraftDesc("");
      setCreateOpen(false);
      toast.success("Objective added");
    } catch (err) {
      toast.error(
        err instanceof PulseError ? err.message : "Could not create objective",
      );
    }
  };

  const handleAddKr = async (objectiveId: string) => {
    if (!krTitle.trim() || !krMetric.trim()) return;
    const target = Number(krTarget);
    if (!Number.isFinite(target) || target <= 0) {
      toast.error("Target must be a positive number");
      return;
    }
    try {
      const kr = await addKeyResultRaw(objectiveId, {
        title: krTitle.trim(),
        metric: krMetric.trim(),
        target,
      });
      setObjectives((prev) =>
        prev.map((o) =>
          o.id === objectiveId
            ? { ...o, keyResults: [...o.keyResults, kr] }
            : o,
        ),
      );
      setKrTitle("");
      setKrMetric("");
      setKrTarget("");
      setKrFormFor(null);
      toast.success("Key result added");
    } catch (err) {
      toast.error(err instanceof PulseError ? err.message : "Could not add KR");
    }
  };

  const adjustKr = async (kr: KeyResult, delta: number) => {
    const next = Math.max(0, kr.current + delta);
    if (next === kr.current) return;
    setBusyKrs((prev) => new Set(prev).add(kr.id));
    // Optimistic
    setObjectives((prev) =>
      prev.map((o) => ({
        ...o,
        keyResults: o.keyResults.map((k) =>
          k.id === kr.id ? { ...k, current: next } : k,
        ),
      })),
    );
    try {
      const updated = await updateKeyResultRaw(kr.id, next);
      setObjectives((prev) =>
        prev.map((o) => ({
          ...o,
          keyResults: o.keyResults.map((k) =>
            k.id === kr.id ? updated : k,
          ),
        })),
      );
    } catch (err) {
      // Rollback
      setObjectives((prev) =>
        prev.map((o) => ({
          ...o,
          keyResults: o.keyResults.map((k) =>
            k.id === kr.id ? { ...k, current: kr.current } : k,
          ),
        })),
      );
      toast.error(
        err instanceof PulseError ? err.message : "Could not update KR",
      );
    } finally {
      setBusyKrs((prev) => {
        const next = new Set(prev);
        next.delete(kr.id);
        return next;
      });
    }
  };

  const archiveObjective = async (id: string) => {
    if (
      typeof window !== "undefined" &&
      !window.confirm("Archive this objective? It will be soft-deleted.")
    )
      return;
    // Optimistic remove from UI.
    const prev = objectives;
    setObjectives((cur) => cur.filter((o) => o.id !== id));
    try {
      await api.pulse.deleteObjective(id);
      toast.success("Objective archived");
    } catch (err) {
      // Rollback on failure.
      setObjectives(prev);
      toast.error(
        err instanceof ApiError ? err.message : "Failed to archive objective",
      );
    }
  };

  const totalKrs = useMemo(
    () => objectives.reduce((sum, o) => sum + o.keyResults.length, 0),
    [objectives],
  );

  return (
    <section className="rounded-xl border border-border bg-card">
      <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-[14px] font-semibold tracking-tight">OKRs</h2>
          <p className="text-[11px] text-muted-foreground">
            {objectives.length} objective{objectives.length === 1 ? "" : "s"} ·{" "}
            {totalKrs} key result{totalKrs === 1 ? "" : "s"}
          </p>
        </div>
        <Select value={quarter} onValueChange={(v) => v && setQuarter(v)}>
          <SelectTrigger className="h-7 w-[110px] text-[11px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {QUARTER_OPTIONS.map((q) => (
              <SelectItem key={q} value={q}>
                {q}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <button
          onClick={() => {
            setDraftQuarter(quarter);
            setCreateOpen(true);
          }}
          className="rounded-md border border-border bg-secondary/50 px-2.5 py-1 text-[11px] text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          + Objective
        </button>
      </header>

      {error && (
        <div className="flex items-center justify-between gap-3 border-b border-amber-500/30 bg-amber-500/5 px-4 py-2 text-[12px] text-amber-300">
          <span>{error}</span>
          <button
            onClick={() => reload(quarter)}
            className="rounded-md border border-amber-500/40 px-2 py-0.5 text-[11px] hover:bg-amber-500/10"
          >
            Retry
          </button>
        </div>
      )}

      <div className="divide-y divide-border/60">
        {loading && (
          <div className="px-4 py-6 text-[13px] text-muted-foreground">
            Loading…
          </div>
        )}
        {!loading && !error && objectives.length === 0 && (
          <div className="px-4 py-8 text-center">
            <p className="text-[13px] font-medium">
              No objectives for {quarter}
            </p>
            <button
              onClick={() => {
                setDraftQuarter(quarter);
                setCreateOpen(true);
              }}
              className="mt-2 text-[11px] text-primary hover:underline"
            >
              + Create one
            </button>
          </div>
        )}
        {objectives.map((o) => (
          <div key={o.id} className="px-4 py-3">
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-[13px] font-semibold">{o.title}</h3>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={(props) => (
                    <button
                      {...props}
                      className="rounded p-0.5 text-[14px] text-muted-foreground hover:bg-accent"
                    >
                      ⋯
                    </button>
                  )}
                />
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onClick={() => {
                      setKrFormFor(o.id);
                      setKrTitle("");
                      setKrMetric("");
                      setKrTarget("");
                    }}
                  >
                    Add key result
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => archiveObjective(o.id)}
                    className="text-red-400 focus:text-red-300"
                  >
                    Archive
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {o.keyResults.length === 0 && krFormFor !== o.id && (
              <button
                onClick={() => {
                  setKrFormFor(o.id);
                  setKrTitle("");
                  setKrMetric("");
                  setKrTarget("");
                }}
                className="mt-1 text-[11px] text-primary hover:underline"
              >
                + Key result
              </button>
            )}

            <div className="mt-2 space-y-2">
              {o.keyResults.map((kr) => {
                const pct =
                  kr.target > 0
                    ? Math.min(100, (kr.current / kr.target) * 100)
                    : 0;
                const busy = busyKrs.has(kr.id);
                return (
                  <div key={kr.id}>
                    <div className="flex items-baseline gap-2 text-[12px]">
                      <span className="min-w-0 flex-1 truncate">
                        {kr.title}
                      </span>
                      <span className="flex-shrink-0 font-mono text-[11px] text-muted-foreground">
                        {kr.current} / {kr.target} {kr.metric}
                      </span>
                      <div className="flex flex-shrink-0 items-center gap-0.5">
                        <button
                          onClick={() => adjustKr(kr, -1)}
                          disabled={busy || kr.current === 0}
                          aria-label="Decrement"
                          className="rounded border border-border bg-secondary/40 px-1.5 text-[11px] leading-tight hover:bg-secondary disabled:opacity-40"
                        >
                          −
                        </button>
                        <button
                          onClick={() => adjustKr(kr, 1)}
                          disabled={busy}
                          aria-label="Increment"
                          className="rounded border border-border bg-secondary/40 px-1.5 text-[11px] leading-tight hover:bg-secondary disabled:opacity-40"
                        >
                          +
                        </button>
                      </div>
                    </div>
                    <div className="mt-1 h-1 overflow-hidden rounded-full bg-secondary">
                      <div
                        className="h-full bg-primary transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}

              {krFormFor === o.id && (
                <div className="mt-2 space-y-1.5 rounded-md border border-border bg-secondary/20 p-2">
                  <Input
                    placeholder="KR title (e.g. Daily active sessions)"
                    value={krTitle}
                    onChange={(e) => setKrTitle(e.target.value)}
                    className="h-7 text-[12px]"
                  />
                  <div className="flex gap-1.5">
                    <Input
                      placeholder="Metric (e.g. sessions)"
                      value={krMetric}
                      onChange={(e) => setKrMetric(e.target.value)}
                      className="h-7 flex-1 text-[12px]"
                    />
                    <Input
                      placeholder="Target"
                      type="number"
                      value={krTarget}
                      onChange={(e) => setKrTarget(e.target.value)}
                      className="h-7 w-20 text-[12px]"
                    />
                  </div>
                  <div className="flex justify-end gap-1.5">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setKrFormFor(null)}
                      className="h-6 px-2 text-[11px]"
                    >
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => handleAddKr(o.id)}
                      disabled={!krTitle.trim() || !krMetric.trim() || !krTarget}
                      className="h-6 px-2 text-[11px]"
                    >
                      Add
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New objective</DialogTitle>
            <DialogDescription>
              Quarterly outcome you want to be true by quarter end.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              placeholder="e.g. Ship the Pulse command center"
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
              autoFocus
            />
            <Textarea
              placeholder="Description (optional)"
              rows={3}
              value={draftDesc}
              onChange={(e) => setDraftDesc(e.target.value)}
            />
            <Select value={draftQuarter} onValueChange={(v) => v && setDraftQuarter(v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {QUARTER_OPTIONS.map((q) => (
                  <SelectItem key={q} value={q}>
                    {q}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCreateOpen(false)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleCreate}
              disabled={!draftTitle.trim()}
            >
              Create
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
