"use client";

import type { TaskEvent } from "@/lib/types";
import { formatRelativeTime } from "@/lib/utils";

interface MemoryTrailCardProps {
  events: TaskEvent[];
}

interface MemoryHit {
  id: number;
  path: string;
  ts: number;
  role: string | null;
}

function extractPath(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  const candidates = [p.file, p.path, p.target, p.filename];
  for (const c of candidates) {
    if (typeof c === "string") return c;
  }
  return null;
}

export function MemoryTrailCard({ events }: MemoryTrailCardProps) {
  const reads: MemoryHit[] = [];
  const writes: MemoryHit[] = [];

  for (const e of events) {
    const path = extractPath(e.payload);
    if (!path) continue;
    const isMemory =
      path.includes(".agent-memory/") || path.includes("shared-memory/");
    if (!isMemory) continue;

    const hit: MemoryHit = {
      id: e.id,
      path,
      ts: e.createdAt,
      role: e.role,
    };
    if (e.type.includes("file-read")) {
      reads.push(hit);
    } else if (e.type.includes("file-edit") || e.type.includes("file-write")) {
      writes.push(hit);
    }
  }

  if (reads.length === 0 && writes.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-3">
        <h3 className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Memory trail
        </h3>
        <p className="mt-2 text-xs text-muted-foreground">
          No memory access on this task yet.
        </p>
      </div>
    );
  }

  const renderList = (label: string, list: MemoryHit[]) => (
    <div>
      <h4 className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label} ({list.length})
      </h4>
      <ul className="space-y-1">
        {list.length === 0 && (
          <li className="text-[11px] text-muted-foreground">—</li>
        )}
        {list.slice(0, 6).map((h) => (
          <li
            key={h.id}
            className="truncate font-mono text-[11px]"
            title={h.path}
          >
            <span className="text-foreground">{h.path.split("/").pop()}</span>
            <span className="ml-1.5 text-muted-foreground">
              {formatRelativeTime(h.ts)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );

  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <h3 className="mb-3 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        Memory trail
      </h3>
      <div className="space-y-3">
        {renderList("Read", reads)}
        {renderList("Written", writes)}
      </div>
    </div>
  );
}
