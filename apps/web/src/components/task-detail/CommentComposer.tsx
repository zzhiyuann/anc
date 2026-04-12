"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { TaskComment } from "@/lib/types";

interface CommentComposerProps {
  taskId: string;
  onPosted: (comment: TaskComment) => void;
}

export function CommentComposer({ taskId, onPosted }: CommentComposerProps) {
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const trimmed = body.trim();
    if (!trimmed) return;
    setSubmitting(true);
    setError(null);
    try {
      const comment = await api.taskComments.create(taskId, trimmed);
      onPosted(comment);
      setBody("");
    } catch (err) {
      // Mock-friendly fallback: synthesize a local comment so the UI still works.
      if (err instanceof ApiError && (err.status === 404 || err.status === 0)) {
        const local: TaskComment = {
          id: -Date.now(),
          taskId,
          author: "ceo",
          body: trimmed,
          parentId: null,
          createdAt: Date.now(),
        };
        onPosted(local);
        setBody("");
      } else {
        setError(err instanceof ApiError ? err.message : "Failed to post");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            void submit();
          }
        }}
        placeholder="Comment as CEO… (⌘Enter to send, supports **bold** and `code`)"
        rows={3}
        className="resize-none border-0 bg-transparent p-0 text-sm focus-visible:ring-0"
        disabled={submitting}
      />
      <div className="mt-2 flex items-center justify-between">
        <span
          className={cn(
            "text-[11px]",
            error ? "text-status-failed" : "text-muted-foreground",
          )}
        >
          {error ?? "Markdown-lite supported"}
        </span>
        <Button
          size="sm"
          onClick={submit}
          disabled={submitting || !body.trim()}
        >
          {submitting ? "Posting..." : "Comment"}
        </Button>
      </div>
    </div>
  );
}
