"use client";

import type { TaskComment } from "@/lib/types";
import { agentInitial, cn, formatRelativeTime } from "@/lib/utils";
import { roleAvatarClass, roleTextClass } from "./role-colors";

interface CommentThreadProps {
  comments: TaskComment[];
}

function authorRole(author: string): string {
  if (author === "ceo") return "ceo";
  if (author.startsWith("agent:")) return author.slice("agent:".length);
  return author;
}

function authorLabel(author: string): string {
  if (author === "ceo") return "CEO";
  if (author.startsWith("agent:")) return author.slice("agent:".length);
  return author;
}

/** Tiny markdown rendering: bold, code, line breaks. No deps. */
function renderInline(body: string): React.ReactNode {
  // Escape, then apply minimal formatters.
  const safe = body
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const html = safe
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, '<code class="rounded bg-secondary px-1 py-0.5 font-mono text-[11px]">$1</code>')
    .replace(/\n/g, "<br />");
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}

export function CommentThread({ comments }: CommentThreadProps) {
  if (comments.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
        No comments yet — be the first to weigh in.
      </p>
    );
  }

  // Build a tree by parentId. Top level = parentId === null.
  const sorted = [...comments].sort((a, b) => a.createdAt - b.createdAt);
  const childrenOf = new Map<number, TaskComment[]>();
  const tops: TaskComment[] = [];
  for (const c of sorted) {
    if (c.parentId == null) {
      tops.push(c);
    } else {
      const arr = childrenOf.get(c.parentId) ?? [];
      arr.push(c);
      childrenOf.set(c.parentId, arr);
    }
  }

  const renderOne = (c: TaskComment, depth: number): React.ReactNode => {
    const role = authorRole(c.author);
    return (
      <div key={c.id} style={{ marginLeft: depth * 20 }} className="space-y-2">
        <div className="flex items-start gap-2.5 rounded-md border border-border bg-card p-3">
          <span
            className={cn(
              "flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
              roleAvatarClass(role),
            )}
          >
            {agentInitial(role)}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2 text-xs">
              <span
                className={cn(
                  "font-semibold uppercase tracking-wide",
                  roleTextClass(role),
                )}
              >
                {authorLabel(c.author)}
              </span>
              <span className="text-muted-foreground">
                {formatRelativeTime(c.createdAt)}
              </span>
            </div>
            <div className="mt-1.5 text-sm leading-relaxed text-foreground/90">
              {renderInline(c.body)}
            </div>
          </div>
        </div>
        {(childrenOf.get(c.id) ?? []).map((child) => renderOne(child, depth + 1))}
      </div>
    );
  };

  return <div className="space-y-2">{tops.map((c) => renderOne(c, 0))}</div>;
}
