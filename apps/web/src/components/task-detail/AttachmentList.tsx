"use client";

import { useState } from "react";
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
  other: "•",
};

function isImage(name: string): boolean {
  return /\.(png|jpe?g|gif|webp|svg)$/i.test(name);
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`;
  return `${(bytes / 1024 / 1024).toFixed(2)}M`;
}

export function AttachmentList({ taskId, attachments }: AttachmentListProps) {
  const [open, setOpen] = useState<TaskAttachment | null>(null);
  const [content, setContent] = useState<string>("");
  const [loading, setLoading] = useState(false);

  const openAttachment = async (att: TaskAttachment) => {
    setOpen(att);
    if (isImage(att.name)) return;
    setLoading(true);
    setContent("");
    try {
      const text = await api.taskAttachments.read(taskId, att.name);
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
  };

  if (attachments.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
        No attachments.
      </p>
    );
  }

  return (
    <>
      <ul className="space-y-1">
        {attachments.map((att) => (
          <li key={att.name}>
            <button
              type="button"
              onClick={() => openAttachment(att)}
              className="flex w-full items-center gap-2 rounded-md border border-border bg-card p-2 text-left transition-colors hover:border-border/80 hover:bg-card/80"
            >
              <span className="w-4 text-center">
                {KIND_ICONS[att.kind] ?? "•"}
              </span>
              <span className="min-w-0 flex-1 truncate font-mono text-xs">
                {att.name}
              </span>
              <span className="shrink-0 text-[10px] text-muted-foreground">
                {formatSize(att.size)}
              </span>
              <span className="shrink-0 text-[10px] text-muted-foreground">
                {formatRelativeTime(att.mtime)}
              </span>
            </button>
          </li>
        ))}
      </ul>

      <Dialog open={open !== null} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="font-mono text-sm">
              {open?.name}
            </DialogTitle>
          </DialogHeader>
          {open &&
            (isImage(open.name) ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={api.taskAttachments.url(taskId, open.name)}
                alt={open.name}
                className="max-h-[60vh] w-full rounded-md object-contain"
              />
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
