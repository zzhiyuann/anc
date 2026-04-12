"use client";

import Link from "next/link";
import { cn, formatRelativeTime } from "@/lib/utils";
import type {
  AncNotification,
  NotificationKind,
  NotificationSeverity,
} from "@/lib/types";

const KIND_ICON: Record<NotificationKind, string> = {
  mention: "💬",
  alert: "⚠️",
  briefing: "📋",
  completion: "✅",
  failure: "❌",
  dispatch: "🚀",
  queue: "📊",
  budget: "💰",
  a2a: "🔁",
};

const SEVERITY_BAR: Record<NotificationSeverity, string> = {
  info: "bg-blue-500",
  warning: "bg-yellow-500",
  critical: "bg-red-500",
};

interface NotificationItemProps {
  notification: AncNotification;
  onMarkRead?: (id: number) => void;
  onArchive?: (id: number) => void;
  onClick?: (n: AncNotification) => void;
  highlight?: boolean;
  expanded?: boolean;
  selected?: boolean;
}

export function NotificationItem({
  notification: n,
  onMarkRead,
  onArchive,
  onClick,
  highlight,
  expanded,
  selected,
}: NotificationItemProps) {
  const isUnread = n.readAt === null;
  const taskHref = n.taskId ? `/tasks/${n.taskId}` : null;

  const body = (
    <div
      className={cn(
        "group relative flex items-start gap-3 px-4 py-3 transition-all",
        isUnread ? "bg-card" : "bg-card/40",
        selected && "ring-1 ring-inset ring-primary/40 bg-secondary/40",
        highlight && "animate-pulse bg-primary/5",
        "hover:bg-secondary/60 cursor-pointer",
      )}
      onClick={() => onClick?.(n)}
    >
      {/* Severity bar */}
      <span
        className={cn(
          "absolute left-0 top-0 bottom-0 w-[3px]",
          SEVERITY_BAR[n.severity],
          !isUnread && "opacity-40",
        )}
      />

      {/* Kind icon */}
      <div className="mt-0.5 text-lg leading-none select-none">
        {KIND_ICON[n.kind] ?? "•"}
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <h3
            className={cn(
              "truncate text-sm",
              isUnread ? "font-semibold text-foreground" : "font-medium text-foreground/70",
            )}
          >
            {n.title}
          </h3>
          <time className="shrink-0 font-mono text-[10px] text-muted-foreground">
            {formatRelativeTime(n.createdAt)}
          </time>
        </div>
        {n.body && (
          <p
            className={cn(
              "mt-0.5 text-xs text-muted-foreground",
              expanded ? "" : "line-clamp-1",
            )}
          >
            {n.body}
          </p>
        )}
        <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground">
          <span className="rounded bg-secondary/60 px-1.5 py-0.5 font-mono uppercase tracking-wide">
            {n.kind}
          </span>
          {n.agentRole && (
            <span className="font-mono">@{n.agentRole}</span>
          )}
          {taskHref && (
            <Link
              href={taskHref}
              onClick={(e) => e.stopPropagation()}
              className="font-mono text-primary hover:underline"
            >
              {n.taskId?.slice(0, 12)}…
            </Link>
          )}
        </div>
      </div>

      {/* Hover actions */}
      <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        {isUnread && onMarkRead && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onMarkRead(n.id);
            }}
            title="Mark read"
            className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            <svg className="size-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M3 8l3 3 7-7" />
            </svg>
          </button>
        )}
        {onArchive && n.archivedAt === null && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onArchive(n.id);
            }}
            title="Archive"
            className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            <svg className="size-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M2 4h12v3H2zM3 7v6h10V7M6 10h4" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );

  return body;
}
