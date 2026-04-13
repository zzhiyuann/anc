"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
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
import { api } from "@/lib/api";
import type { Decision, AgentStatus, Task } from "@/lib/types";
import { formatRelativeTime, formatTimestamp } from "@/lib/utils";
import { PulseError } from "@/components/pulse/pulse-client";

const TASK_TAG_PREFIX = "task:";

export function DecisionLogCard() {
  const [items, setItems] = useState<Decision[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [viewing, setViewing] = useState<Decision | null>(null);

  const [title, setTitle] = useState("");
  const [rationale, setRationale] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [decidedBy, setDecidedBy] = useState<string>("ceo");
  const [linkedTaskId, setLinkedTaskId] = useState<string>("");

  const [roles, setRoles] = useState<string[]>(["engineer", "strategist", "ops"]);
  const [tasks, setTasks] = useState<Task[]>([]);

  const reload = async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await api.pulse.listDecisions(10);
      setItems(list);
    } catch (err) {
      setItems([]);
      setError(
        err instanceof Error
          ? `Failed to load decisions — ${err.message}`
          : "Failed to load decisions",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
  }, []);

  // Lazy-load roles + tasks for the create form.
  useEffect(() => {
    if (!createOpen) return;
    let cancelled = false;
    void api.agents
      .list()
      .then((rows: AgentStatus[]) => {
        if (!cancelled) setRoles(rows.map((r) => r.role));
      })
      .catch(() => {
        /* keep fallback */
      });
    void api.tasks
      .list({})
      .then((rows: Task[]) => {
        if (!cancelled) {
          // Most recent first.
          setTasks(rows.slice().sort((a, b) => b.createdAt - a.createdAt).slice(0, 50));
        }
      })
      .catch(() => {
        /* picker stays empty */
      });
    return () => {
      cancelled = true;
    };
  }, [createOpen]);

  const handleCreate = async () => {
    if (!title.trim() || !rationale.trim()) return;
    try {
      const tags = tagsInput
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      // Encode link-to-task as a tag the UI can later parse.
      if (linkedTaskId) tags.push(`${TASK_TAG_PREFIX}${linkedTaskId}`);
      const dec = await api.pulse.createDecision({
        title: title.trim(),
        rationale: rationale.trim(),
        tags,
      });
      // The shared api.pulse.createDecision hardcodes decidedBy: "ceo".
      // If the user picked someone else, override locally so the optimistic
      // entry reflects their pick (the persisted record will read "ceo" until
      // the lib helper accepts decidedBy — gap noted in report).
      const local: Decision =
        decidedBy === "ceo" ? dec : { ...dec, decidedBy };
      setItems((prev) => [local, ...prev].slice(0, 10));
      setTitle("");
      setRationale("");
      setTagsInput("");
      setLinkedTaskId("");
      setDecidedBy("ceo");
      setCreateOpen(false);
      toast.success("Decision logged");
    } catch (err) {
      toast.error(
        err instanceof PulseError ? err.message : "Could not log decision",
      );
    }
  };

  const linkedTaskOf = (d: Decision): string | null => {
    const tag = d.tags.find((t) => t.startsWith(TASK_TAG_PREFIX));
    return tag ? tag.slice(TASK_TAG_PREFIX.length) : null;
  };

  const visibleTags = (d: Decision): string[] =>
    d.tags.filter((t) => !t.startsWith(TASK_TAG_PREFIX));

  return (
    <section className="rounded-xl border border-border bg-card">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <div>
          <h2 className="text-[14px] font-semibold tracking-tight">
            Decision log
          </h2>
          <p className="text-[11px] text-muted-foreground">
            {items.length} recent
          </p>
        </div>
        <button
          onClick={() => setCreateOpen(true)}
          className="rounded-md border border-border bg-secondary/50 px-2.5 py-1 text-[11px] text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          + Log decision
        </button>
      </header>

      {error && (
        <div className="flex items-center justify-between gap-3 border-b border-amber-500/30 bg-amber-500/5 px-4 py-2 text-[12px] text-amber-300">
          <span>{error}</span>
          <button
            onClick={reload}
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
        {!loading && !error && items.length === 0 && (
          <div className="px-4 py-8 text-center">
            <p className="text-[13px] font-medium">No decisions yet</p>
            <p className="text-[11px] text-muted-foreground">
              Capture the next call so future you knows the why.
            </p>
          </div>
        )}
        {items.map((d) => {
          const tags = visibleTags(d);
          return (
            <button
              key={d.id}
              onClick={() => setViewing(d)}
              className="w-full px-4 py-3 text-left hover:bg-accent/30"
            >
              <p className="truncate text-[13px] font-medium">{d.title}</p>
              <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                <span className="font-mono">{d.decidedBy}</span>
                <span>·</span>
                <span>{formatRelativeTime(d.createdAt)}</span>
                {tags.length > 0 && <span>·</span>}
                <div className="flex flex-wrap gap-1">
                  {tags.map((t) => (
                    <span
                      key={t}
                      className="rounded-full border border-border bg-secondary/50 px-1.5 py-0.5 text-[10px] text-muted-foreground"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <Dialog open={viewing !== null} onOpenChange={(o) => !o && setViewing(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{viewing?.title}</DialogTitle>
            <DialogDescription>
              {viewing
                ? `${viewing.decidedBy} · ${formatTimestamp(viewing.createdAt)}`
                : ""}
            </DialogDescription>
          </DialogHeader>
          {viewing && (
            <div className="space-y-3">
              <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-foreground">
                {viewing.rationale}
              </p>
              {visibleTags(viewing).length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {visibleTags(viewing).map((t) => (
                    <span
                      key={t}
                      className="rounded-full border border-border bg-secondary/50 px-2 py-0.5 text-[11px] text-muted-foreground"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              )}
              {linkedTaskOf(viewing) && (
                <Link
                  href={`/tasks/${linkedTaskOf(viewing)}`}
                  className="inline-block text-[12px] text-primary hover:underline"
                  onClick={() => setViewing(null)}
                >
                  → Linked task: {linkedTaskOf(viewing)}
                </Link>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Log a decision</DialogTitle>
            <DialogDescription>
              Capture what you decided and why, so it doesn&apos;t get
              re-litigated.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              placeholder="What did you decide?"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
            />
            <Textarea
              placeholder="Rationale (markdown supported) — what tradeoff did this resolve?"
              rows={5}
              value={rationale}
              onChange={(e) => setRationale(e.target.value)}
            />
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Decided by
                </label>
                <Select value={decidedBy} onValueChange={(v) => v && setDecidedBy(v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ceo">ceo</SelectItem>
                    {roles.map((r) => (
                      <SelectItem key={r} value={`agent:${r}`}>
                        agent:{r}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Link to task (optional)
                </label>
                <Select
                  value={linkedTaskId || "__none__"}
                  onValueChange={(v) =>
                    setLinkedTaskId(!v || v === "__none__" ? "" : v)
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="None" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">None</SelectItem>
                    {tasks.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.title.slice(0, 50)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Input
              placeholder="Tags (comma-separated)"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
            />
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
              disabled={!title.trim() || !rationale.trim()}
            >
              Log
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
