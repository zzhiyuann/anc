"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import type { ProcessEvent, TaskEvent } from "@/lib/types";
import { cn, formatRelativeTime } from "@/lib/utils";

interface ProcessStreamProps {
  taskId: string;
  /** Historical events from TaskFull.events. */
  initialEvents: TaskEvent[];
  /** Live events streamed via WS subscribeToTask. */
  liveEvents: ProcessEvent[];
}

type StreamItem = {
  id: string;
  ts: number;
  role: string | null;
  type: string;
  preview: string;
  payload?: unknown;
};

const PROCESS_TYPE_PREFIXES = [
  "agent:tool-call",
  "agent:file-",
  "agent:bash",
  "agent:thinking",
  "agent:plan",
];

function isProcessType(type: string): boolean {
  return PROCESS_TYPE_PREFIXES.some((p) => type.startsWith(p));
}

function iconFor(type: string): string {
  if (type.includes("file-read")) return "📄";
  if (type.includes("file-edit") || type.includes("file-write")) return "✏️";
  if (type.includes("bash")) return "⚡";
  if (type.includes("thinking")) return "🤔";
  if (type.includes("plan")) return "📋";
  if (type.includes("done") || type.includes("completed")) return "🏁";
  if (type.includes("tool-call")) return "🔧";
  return "•";
}

function previewFromPayload(type: string, payload: unknown): string {
  if (!payload || typeof payload !== "object") return type;
  const p = payload as Record<string, unknown>;
  if (typeof p.preview === "string") return p.preview;
  if (typeof p.file === "string") return String(p.file);
  if (typeof p.input === "string") return String(p.input).slice(0, 120);
  if (typeof p.tool === "string") return String(p.tool);
  if (typeof p.plan === "string") return String(p.plan).slice(0, 160);
  return type.replace("agent:", "");
}

type FilterKey = "all" | "tool" | "file" | "bash" | "thinking";

const FILTERS: Array<{ key: FilterKey; label: string }> = [
  { key: "all", label: "All" },
  { key: "tool", label: "Tool calls" },
  { key: "file", label: "File edits" },
  { key: "bash", label: "Bash" },
  { key: "thinking", label: "Thinking" },
];

function matchesFilter(type: string, f: FilterKey): boolean {
  if (f === "all") return true;
  if (f === "tool") return type.includes("tool-call");
  if (f === "file") return type.includes("file-");
  if (f === "bash") return type.includes("bash");
  if (f === "thinking") return type.includes("thinking");
  return true;
}

export function ProcessStream({
  taskId,
  initialEvents,
  liveEvents,
}: ProcessStreamProps) {
  const [expanded, setExpanded] = useState(false);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [openRow, setOpenRow] = useState<string | null>(null);

  const items: StreamItem[] = useMemo(() => {
    const fromHistory: StreamItem[] = initialEvents
      .filter((e) => isProcessType(e.type))
      .map((e) => ({
        id: `h-${e.id}`,
        ts: e.createdAt,
        role: e.role,
        type: e.type,
        preview: previewFromPayload(e.type, e.payload),
        payload: e.payload,
      }));

    const fromLive: StreamItem[] = liveEvents
      .filter((e) => e.taskId === taskId)
      .map((e, i) => ({
        id: `l-${e.ts}-${i}`,
        ts: e.ts,
        role: e.role,
        type: e.eventType,
        preview: e.preview,
      }));

    const all = [...fromHistory, ...fromLive].sort((a, b) => a.ts - b.ts);
    return all;
  }, [initialEvents, liveEvents, taskId]);

  const stats = useMemo(() => {
    let toolCalls = 0;
    let fileEdits = 0;
    let bash = 0;
    for (const it of items) {
      if (it.type.includes("tool-call")) toolCalls++;
      if (it.type.includes("file-edit") || it.type.includes("file-write"))
        fileEdits++;
      if (it.type.includes("bash")) bash++;
    }
    return { total: items.length, toolCalls, fileEdits, bash };
  }, [items]);

  const filtered = items.filter((it) => matchesFilter(it.type, filter));

  if (items.length === 0) {
    return null;
  }

  return (
    <div className="rounded-lg border border-border bg-card">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs"
      >
        <div className="flex items-center gap-3 text-muted-foreground">
          <span className="font-medium text-foreground">Process</span>
          <span>·</span>
          <span>{stats.total} events</span>
          <span>·</span>
          <span>{stats.toolCalls} tool calls</span>
          <span>·</span>
          <span>{stats.fileEdits} file edits</span>
          <span>·</span>
          <span>{stats.bash} bash</span>
        </div>
        <span className="text-muted-foreground">{expanded ? "▼ Collapse" : "▶ Expand"}</span>
      </button>

      {expanded && (
        <div className="border-t border-border">
          <div className="flex items-center gap-1 border-b border-border px-3 py-2">
            {FILTERS.map((f) => (
              <Button
                key={f.key}
                size="sm"
                variant={filter === f.key ? "default" : "ghost"}
                className="h-6 px-2 text-[11px]"
                onClick={() => setFilter(f.key)}
              >
                {f.label}
              </Button>
            ))}
          </div>

          <div className="max-h-[360px] overflow-y-auto font-mono text-[11px]">
            {filtered.length === 0 && (
              <div className="px-3 py-6 text-center text-muted-foreground">
                No events match this filter.
              </div>
            )}
            {filtered.map((it) => {
              const open = openRow === it.id;
              return (
                <div key={it.id} className="border-b border-border/50 last:border-b-0">
                  <button
                    type="button"
                    onClick={() => setOpenRow(open ? null : it.id)}
                    className={cn(
                      "flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-secondary/40",
                      open && "bg-secondary/40",
                    )}
                  >
                    <span className="w-4 text-center">{iconFor(it.type)}</span>
                    <span className="w-20 shrink-0 text-muted-foreground">
                      {formatRelativeTime(it.ts)}
                    </span>
                    {it.role && (
                      <span className="w-20 shrink-0 truncate text-muted-foreground">
                        {it.role}
                      </span>
                    )}
                    <span className="flex-1 truncate">{it.preview}</span>
                    <span className="shrink-0 text-muted-foreground/60">
                      {it.type.replace("agent:", "")}
                    </span>
                  </button>
                  {open && it.payload !== undefined && (
                    <pre className="overflow-x-auto bg-[oklch(0.07_0.005_260)] px-3 py-2 text-[10px] text-muted-foreground">
                      {JSON.stringify(it.payload, null, 2)}
                    </pre>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
