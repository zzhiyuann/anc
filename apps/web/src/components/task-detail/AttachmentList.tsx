"use client";

import { useCallback, useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { TaskAttachment } from "@/lib/types";
import { cn, formatRelativeTime } from "@/lib/utils";
import { FilePreview } from "./FilePreview";

interface AttachmentListProps {
  taskId: string;
  attachments: TaskAttachment[];
}

const KIND_ICONS: Record<string, string> = {
  handoff: "📄",
  retro: "🔄",
  suspend: "⏸",
  code: "📁",
  memory: "🧠",
  text: "📄",
  json: "{}",
  image: "🖼",
  binary: "■",
  dir: "📁",
  other: "•",
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`;
  return `${(bytes / 1024 / 1024).toFixed(2)}M`;
}

interface DirState {
  loading: boolean;
  error: string | null;
  entries: TaskAttachment[] | null;
  open: boolean;
}

export function AttachmentList({ taskId, attachments }: AttachmentListProps) {
  // Expanded file preview — stores the full path of the currently expanded file (or null)
  const [expandedFile, setExpandedFile] = useState<string | null>(null);

  // Per-path dir state. Key = relative path of the directory.
  const [dirs, setDirs] = useState<Record<string, DirState>>({});

  const toggleFile = useCallback(
    (att: TaskAttachment, path: string) => {
      if (att.kind === "dir") return;
      setExpandedFile((prev) => (prev === path ? null : path));
    },
    [],
  );

  const toggleDir = useCallback(
    async (path: string) => {
      const cur = dirs[path];
      if (cur?.entries) {
        setDirs((d) => ({ ...d, [path]: { ...cur, open: !cur.open } }));
        return;
      }
      setDirs((d) => ({
        ...d,
        [path]: { loading: true, error: null, entries: null, open: true },
      }));
      try {
        const r = await api.taskAttachments.readDir(taskId, path);
        setDirs((d) => ({
          ...d,
          [path]: { loading: false, error: null, entries: r.entries, open: true },
        }));
      } catch (err) {
        const msg = err instanceof ApiError ? err.message : "failed to read directory";
        setDirs((d) => ({
          ...d,
          [path]: { loading: false, error: msg, entries: null, open: true },
        }));
      }
    },
    [dirs, taskId],
  );

  const handleEntryClick = useCallback(
    (att: TaskAttachment, parentPath: string) => {
      const path = parentPath ? `${parentPath}/${att.name}` : att.name;
      if (att.kind === "dir") {
        void toggleDir(path);
      } else {
        toggleFile(att, path);
      }
    },
    [toggleFile, toggleDir],
  );

  if (!attachments || attachments.length === 0) {
    return null;
  }

  const renderRow = (att: TaskAttachment, parentPath: string, depth: number) => {
    const path = parentPath ? `${parentPath}/${att.name}` : att.name;
    const dirState = att.kind === "dir" ? dirs[path] : undefined;
    const isOpen = att.kind === "dir" && dirState?.open;
    const isExpanded = att.kind !== "dir" && expandedFile === path;

    return (
      <li key={path}>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => handleEntryClick(att, parentPath)}
            className={cn(
              "flex flex-1 items-center gap-2 rounded-md border border-border bg-card p-2 text-left transition-colors hover:border-border/80 hover:bg-card/80",
              isExpanded && "border-primary/30 bg-card/90",
            )}
            style={{ paddingLeft: `${0.5 + depth * 0.75}rem` }}
          >
            <span className="w-4 text-center">
              {att.kind === "dir" ? (isOpen ? "📂" : "📁") : (KIND_ICONS[att.kind] ?? "•")}
            </span>
            <span className="min-w-0 flex-1 truncate font-mono text-xs">
              {att.name}
            </span>
            <span className="shrink-0 text-[10px] text-muted-foreground">
              {att.kind === "dir" ? "" : formatSize(att.size)}
            </span>
            <span className="shrink-0 text-[10px] text-muted-foreground">
              {formatRelativeTime(att.mtime)}
            </span>
          </button>
          {att.kind !== "dir" && (
            <a
              href={api.taskAttachments.url(taskId, path)}
              download={att.name}
              onClick={(e) => e.stopPropagation()}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-card text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              title={`Download ${att.name}`}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 16 16"
                fill="currentColor"
                className="h-3 w-3"
              >
                <path d="M8 1a.75.75 0 0 1 .75.75v6.69l1.72-1.72a.75.75 0 1 1 1.06 1.06l-3 3a.75.75 0 0 1-1.06 0l-3-3a.75.75 0 0 1 1.06-1.06l1.72 1.72V1.75A.75.75 0 0 1 8 1ZM2.75 10a.75.75 0 0 1 .75.75v1.5c0 .414.336.75.75.75h7.5a.75.75 0 0 0 .75-.75v-1.5a.75.75 0 0 1 1.5 0v1.5A2.25 2.25 0 0 1 11.75 14.5h-7.5A2.25 2.25 0 0 1 2 12.25v-1.5a.75.75 0 0 1 .75-.75Z" />
              </svg>
            </a>
          )}
        </div>

        {/* Inline file preview — accordion style */}
        {isExpanded && (
          <div
            className="overflow-hidden transition-all duration-200 ease-in-out"
            style={{ paddingLeft: `${0.5 + depth * 0.75}rem` }}
          >
            <FilePreview
              taskId={taskId}
              path={path}
              kind={att.kind}
              size={att.size}
              mtime={att.mtime}
            />
          </div>
        )}

        {att.kind === "dir" && isOpen && (
          <ul className="mt-1 space-y-1">
            {dirState?.loading && (
              <li
                className="px-2 py-1 text-[11px] text-muted-foreground"
                style={{ paddingLeft: `${0.5 + (depth + 1) * 0.75}rem` }}
              >
                Loading...
              </li>
            )}
            {dirState?.error && (
              <li
                className="px-2 py-1 text-[11px] text-status-failed"
                style={{ paddingLeft: `${0.5 + (depth + 1) * 0.75}rem` }}
              >
                {dirState.error}
              </li>
            )}
            {dirState?.entries?.length === 0 && (
              <li
                className="px-2 py-1 text-[11px] text-muted-foreground"
                style={{ paddingLeft: `${0.5 + (depth + 1) * 0.75}rem` }}
              >
                (empty)
              </li>
            )}
            {dirState?.entries?.map((child) => renderRow(child, path, depth + 1))}
          </ul>
        )}
      </li>
    );
  };

  return (
    <ul className="space-y-1">
      {attachments.map((att) => renderRow(att, "", 0))}
    </ul>
  );
}
