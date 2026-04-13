"use client";

import { useCallback, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { api, ApiError } from "@/lib/api";
import type { TaskAttachment } from "@/lib/types";
import { cn, formatRelativeTime } from "@/lib/utils";

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

function isImageName(name: string): boolean {
  return /\.(png|jpe?g|gif|webp|svg)$/i.test(name);
}

function isBinaryKind(att: TaskAttachment): boolean {
  return att.kind === "binary" || (att.kind !== "image" && /\.(pdf|zip|tar|gz|bin|exe|dmg)$/i.test(att.name));
}

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
  // Modal state for files
  const [open, setOpen] = useState<{ att: TaskAttachment; path: string } | null>(null);
  const [content, setContent] = useState<string>("");
  const [loading, setLoading] = useState(false);

  // Per-path dir state. Key = relative path of the directory.
  const [dirs, setDirs] = useState<Record<string, DirState>>({});

  const openFile = useCallback(
    async (att: TaskAttachment, path: string) => {
      setOpen({ att, path });
      if (isImageName(att.name) || isBinaryKind(att)) return;
      setLoading(true);
      setContent("");
      try {
        const text = await api.taskAttachments.read(taskId, path);
        setContent(text);
      } catch (err) {
        setContent(
          err instanceof ApiError
            ? `(unable to load: ${err.message})`
            : "(unable to load attachment)",
        );
      } finally {
        setLoading(false);
      }
    },
    [taskId],
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
        void openFile(att, path);
      }
    },
    [openFile, toggleDir],
  );

  if (!attachments || attachments.length === 0) {
    return null;
  }

  const renderRow = (att: TaskAttachment, parentPath: string, depth: number) => {
    const path = parentPath ? `${parentPath}/${att.name}` : att.name;
    const dirState = att.kind === "dir" ? dirs[path] : undefined;
    const isOpen = att.kind === "dir" && dirState?.open;
    return (
      <li key={path}>
        <button
          type="button"
          onClick={() => handleEntryClick(att, parentPath)}
          className="flex w-full items-center gap-2 rounded-md border border-border bg-card p-2 text-left transition-colors hover:border-border/80 hover:bg-card/80"
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
        {att.kind === "dir" && isOpen && (
          <ul className="mt-1 space-y-1">
            {dirState?.loading && (
              <li
                className="px-2 py-1 text-[11px] text-muted-foreground"
                style={{ paddingLeft: `${0.5 + (depth + 1) * 0.75}rem` }}
              >
                Loading…
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
    <>
      <ul className="space-y-1">
        {attachments.map((att) => renderRow(att, "", 0))}
      </ul>

      <Dialog open={open !== null} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="font-mono text-sm">
              {open?.path ?? open?.att.name}
            </DialogTitle>
          </DialogHeader>
          {open &&
            (isImageName(open.att.name) ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={api.taskAttachments.url(taskId, open.path)}
                alt={open.att.name}
                className="max-h-[60vh] w-full rounded-md object-contain"
              />
            ) : isBinaryKind(open.att) ? (
              <a
                href={api.taskAttachments.url(taskId, open.path)}
                download={open.att.name}
                className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-xs hover:bg-card/80"
              >
                Download {open.att.name} ({formatSize(open.att.size)})
              </a>
            ) : (
              <ScrollArea className="max-h-[60vh] rounded-md border border-border bg-[oklch(0.07_0.005_260)] p-3">
                <pre
                  className={cn(
                    "whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed",
                    loading && "text-muted-foreground",
                  )}
                >
                  {loading ? "Loading..." : content}
                </pre>
              </ScrollArea>
            ))}
        </DialogContent>
      </Dialog>
    </>
  );
}
