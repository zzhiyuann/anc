"use client";

/**
 * MemoryTab — list of files in `~/.anc/agents/<role>/memory/`.
 *
 * Backend reality: the only memory endpoint exposed today is
 *   GET /api/v1/agents/:role/memory  →  { role, files: string[] }
 * which returns FILENAMES ONLY. There is no read / write / delete endpoint
 * for individual memory files. As a result this tab can:
 *   - list files (real)
 *   - show file size / mtime: NO (gap)
 *   - read file content: NO (gap)
 *   - create / edit / delete: NO (gap)
 *
 * Documented in the report. Buttons that depend on missing endpoints render
 * a clear "Not wired yet" notice instead of a fake editor.
 */

import { useEffect, useState } from "react";
import { FileText, Loader2 } from "lucide-react";
import { api } from "@/lib/api";

interface MemoryTabProps {
  role: string;
  initialFiles: string[];
}

export function MemoryTab({ role, initialFiles }: MemoryTabProps) {
  const [files, setFiles] = useState<string[]>(initialFiles);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setRefreshing(true);
    (async () => {
      try {
        const m = await api.agents.memory(role);
        if (!cancelled) setFiles(m.files);
      } catch {
        // Keep initialFiles on error.
      } finally {
        if (!cancelled) setRefreshing(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [role]);

  if (files.length === 0) {
    return (
      <div className="space-y-3">
        <div className="rounded-lg border border-dashed border-border p-10 text-center">
          <p className="text-sm text-muted-foreground">
            No memory files yet · agent will create them as it works.
          </p>
        </div>
        <BackendGapNote />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span>
          {files.length} file{files.length === 1 ? "" : "s"} ·{" "}
          <span className="font-mono">~/.anc/agents/{role}/memory/</span>
        </span>
        {refreshing && <span>refreshing…</span>}
      </div>
      <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
        {files.map((filename) => (
          <li
            key={filename}
            className="flex items-center gap-3 px-4 py-3 text-[13px]"
          >
            <FileText className="size-4 shrink-0 text-muted-foreground" />
            <span className="font-mono">{filename}</span>
          </li>
        ))}
      </ul>
      <BackendGapNote />
    </div>
  );
}

function BackendGapNote() {
  return (
    <div className="rounded-lg border border-dashed border-border p-3 text-[12px] text-muted-foreground">
      <div className="mb-1 font-medium text-foreground/80">
        Read / edit / create
      </div>
      Not wired yet — backend exposes{" "}
      <span className="font-mono">GET /agents/:role/memory</span> (filenames
      only). No read / write / delete endpoints for individual memory files.
    </div>
  );
}

// Mark Loader2 used to silence unused warnings if we add a spinner later.
void Loader2;
