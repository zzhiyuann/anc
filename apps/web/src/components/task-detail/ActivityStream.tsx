"use client";

import { useMemo } from "react";
import type { TaskComment, TaskEvent } from "@/lib/types";
import { agentInitial, cn, formatRelativeTime } from "@/lib/utils";
import { roleAvatarClass, roleTextClass } from "./role-colors";

interface ActivityStreamProps {
  events: TaskEvent[];
  comments: TaskComment[];
}

type StreamItem =
  | { kind: "comment"; ts: number; comment: TaskComment }
  | { kind: "event"; ts: number; event: TaskEvent };

// Event types we render as one-line activity rows. Anything noisy (tool calls,
// file edits, bash) lives in ProcessStream instead.
const ACTIVITY_TYPES = [
  "task:created",
  "task:state-changed",
  "task:updated",
  "task:renamed",
  "task:assigned",
  "task:dispatched",
  "task:completed",
  "agent:spawned",
  "agent:completed",
  "agent:failed",
  "agent:idle",
  "agent:suspended",
  "agent:resumed",
  "attachment:added",
  "handoff:attached",
  "label:added",
  "label:removed",
];

function isActivity(type: string): boolean {
  return ACTIVITY_TYPES.some((t) => type === t || type.startsWith(`${t}.`));
}

/** Map task state names to Tailwind color classes for inline labels. */
function stateColorClass(state: string): string {
  switch (state) {
    case "running":
      return "text-status-active";
    case "done":
      return "text-status-completed";
    case "failed":
      return "text-status-failed";
    case "review":
      return "text-blue-400";
    default:
      return "text-muted-foreground";
  }
}

function capitalizeState(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function describeEvent(e: TaskEvent): string {
  const p = (e.payload as Record<string, unknown> | null) ?? {};
  if (typeof p.preview === "string") return p.preview;
  if (typeof p.message === "string") return p.message as string;
  if (typeof p.detail === "string") return p.detail as string;

  if (e.type === "task:state-changed" && typeof p.to === "string") {
    // Plain-text fallback; rich rendering handled by describeEventNode
    const from = typeof p.from === "string" ? p.from : "?";
    return `changed status from ${capitalizeState(from)} → ${capitalizeState(p.to)}`;
  }
  if (e.type === "task:updated") {
    const patch = (p.patch as Record<string, unknown> | undefined) ?? {};
    const keys = Object.keys(patch);
    if (keys.length === 1 && typeof patch[keys[0]] !== "undefined") {
      const val = patch[keys[0]];
      return typeof val === "string"
        ? `changed ${keys[0]} to ${val}`
        : `updated ${keys[0]}`;
    }
    return keys.length > 0 ? `updated ${keys.join(", ")}` : "updated task";
  }
  if (e.type === "task:renamed" && typeof p.to === "string") {
    return `renamed to "${p.to}"`;
  }
  if (e.type === "task:assigned" && typeof p.assignee === "string") {
    return `assigned to ${p.assignee}`;
  }
  if (e.type === "attachment:added" && typeof p.name === "string") {
    return `attached ${p.name}`;
  }
  if (e.type === "task:dispatched" && typeof p.role === "string") {
    return `dispatched ${p.role}`;
  }
  return e.type.replace(/^task:|^agent:/, "").replace(/-/g, " ");
}

/** Rich React node for state-changed events (colored from/to labels). */
function describeEventNode(e: TaskEvent): React.ReactNode {
  const p = (e.payload as Record<string, unknown> | null) ?? {};
  if (e.type === "task:state-changed" && typeof p.to === "string") {
    const from = typeof p.from === "string" ? p.from : "?";
    return (
      <>
        changed status from{" "}
        <span className={cn("font-medium", stateColorClass(from))}>
          {capitalizeState(from)}
        </span>
        {" → "}
        <span className={cn("font-medium", stateColorClass(p.to))}>
          {capitalizeState(p.to)}
        </span>
      </>
    );
  }
  return describeEvent(e);
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

function renderInline(body: string): React.ReactNode {
  const safe = body
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const html = safe
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(
      /`([^`]+)`/g,
      '<code class="rounded bg-secondary px-1 py-0.5 font-mono text-[11px]">$1</code>',
    )
    .replace(
      /(^|\s)@([\w-]+)/g,
      '$1<span class="rounded bg-accent px-1 py-0.5 text-[11px] font-medium text-foreground">@$2</span>',
    )
    .replace(/\n/g, "<br />");
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}

export function ActivityStream({ events, comments }: ActivityStreamProps) {
  const items: StreamItem[] = useMemo(() => {
    const list: StreamItem[] = [];
    for (const c of comments) {
      list.push({ kind: "comment", ts: c.createdAt, comment: c });
    }
    for (const e of events) {
      if (!isActivity(e.type)) continue;
      list.push({ kind: "event", ts: e.createdAt, event: e });
    }
    list.sort((a, b) => a.ts - b.ts);
    return list;
  }, [events, comments]);

  if (items.length === 0) {
    return (
      <p className="text-[11px] text-muted-foreground">
        No activity yet · Leave a comment to start
      </p>
    );
  }

  return (
    <ol className="relative space-y-2 border-l border-border pl-3">
      {items.map((it) => {
        if (it.kind === "comment") {
          const c = it.comment;
          const role = authorRole(c.author);
          return (
            <li key={`c-${c.id}`} className="relative">
              <span
                aria-hidden
                className="absolute -left-[15px] top-2 size-1.5 rounded-full bg-border"
              />
              <div className="flex items-start gap-2 rounded-md border border-border bg-card px-3 py-2">
                <span
                  className={cn(
                    "flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold",
                    roleAvatarClass(role),
                  )}
                >
                  {agentInitial(role)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2 text-[10px]">
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
                  <div className="mt-0.5 text-[12px] leading-relaxed text-foreground/90">
                    {renderInline(c.body)}
                  </div>
                </div>
              </div>
            </li>
          );
        }
        const e = it.event;
        const p = (e.payload as Record<string, unknown> | null) ?? {};
        // Prefer the `by` field in payload (state-changed / updated events),
        // then fall back to event-level role.
        const rawBy = typeof p.by === "string" ? p.by : null;
        const role = rawBy ? authorRole(rawBy) : (e.role ?? "system");
        return (
          <li
            key={`e-${e.id}`}
            className="relative flex items-center gap-2 text-[11px] text-muted-foreground"
          >
            <span
              aria-hidden
              className="absolute -left-[15px] top-1/2 size-1.5 -translate-y-1/2 rounded-full bg-border"
            />
            <span
              className={cn(
                "flex size-4 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold",
                roleAvatarClass(role),
              )}
            >
              {agentInitial(role)}
            </span>
            <span className={cn("font-medium", roleTextClass(role))}>
              {role}
            </span>
            <span className="min-w-0 flex-1 truncate">{describeEventNode(e)}</span>
            <span className="shrink-0 text-muted-foreground/70">
              {formatRelativeTime(e.createdAt)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
