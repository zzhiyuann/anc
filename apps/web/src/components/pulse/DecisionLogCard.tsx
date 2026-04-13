"use client";

import { useEffect, useState } from "react";
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
import { api } from "@/lib/api";
import type { Decision } from "@/lib/types";
import { formatRelativeTime, formatTimestamp } from "@/lib/utils";

export function DecisionLogCard() {
  const [items, setItems] = useState<Decision[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [viewing, setViewing] = useState<Decision | null>(null);

  const [title, setTitle] = useState("");
  const [rationale, setRationale] = useState("");
  const [tagsInput, setTagsInput] = useState("");

  useEffect(() => {
    let aborted = false;
    api.pulse
      .listDecisions(5)
      .then((res) => {
        if (!aborted) setItems(res);
      })
      .catch(() => {
        if (!aborted) setItems([]);
      })
      .finally(() => {
        if (!aborted) setLoading(false);
      });
    return () => {
      aborted = true;
    };
  }, []);

  const handleCreate = async () => {
    if (!title.trim() || !rationale.trim()) return;
    try {
      const tags = tagsInput
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      const dec = await api.pulse.createDecision({
        title: title.trim(),
        rationale: rationale.trim(),
        tags,
      });
      setItems((prev) => [dec, ...prev].slice(0, 5));
      setTitle("");
      setRationale("");
      setTagsInput("");
      setCreateOpen(false);
      toast.success("Decision logged");
    } catch {
      toast.error("Could not log decision");
    }
  };

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

      <div className="divide-y divide-border/60">
        {loading && (
          <div className="px-4 py-6 text-[13px] text-muted-foreground">
            Loading…
          </div>
        )}
        {!loading && items.length === 0 && (
          <div className="px-4 py-8 text-center">
            <p className="text-[13px] font-medium">No decisions yet</p>
            <p className="text-[11px] text-muted-foreground">
              Capture the next call so future you knows the why.
            </p>
          </div>
        )}
        {items.map((d) => (
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
              {d.tags.length > 0 && <span>·</span>}
              <div className="flex flex-wrap gap-1">
                {d.tags.map((t) => (
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
        ))}
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
              {viewing.tags.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {viewing.tags.map((t) => (
                    <span
                      key={t}
                      className="rounded-full border border-border bg-secondary/50 px-2 py-0.5 text-[11px] text-muted-foreground"
                    >
                      {t}
                    </span>
                  ))}
                </div>
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
              placeholder="Rationale — what tradeoff did this resolve?"
              rows={4}
              value={rationale}
              onChange={(e) => setRationale(e.target.value)}
            />
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
