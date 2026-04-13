"use client";

// Wave A: legacy CommentComposer is now a thin wrapper around MentionComposer
// so all comment entry points share the same @-mention behavior.

import { MentionComposer } from "@/components/mention-composer";
import type { TaskComment } from "@/lib/types";

interface CommentComposerProps {
  taskId: string;
  onPosted: (comment: TaskComment) => void;
}

export function CommentComposer({ taskId, onPosted }: CommentComposerProps) {
  return <MentionComposer taskId={taskId} onPosted={onPosted} />;
}
