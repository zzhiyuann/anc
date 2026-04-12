import type { EventRow } from "@/lib/types";
import { cn, formatRelativeTime } from "@/lib/utils";

// Event type prefixes from src/bus.ts — mapped to icon + color.
// See src/api/ws.ts for the broadcast event list.
type IconKind =
  | "play"
  | "check"
  | "x"
  | "pause"
  | "plus"
  | "arrow"
  | "heart"
  | "msg";

interface EventVisual {
  icon: IconKind;
  color: string;
}

function eventVisual(type: string): EventVisual {
  switch (type) {
    case "agent:spawned":
      return { icon: "play", color: "text-status-active" };
    case "agent:completed":
      return { icon: "check", color: "text-status-completed" };
    case "agent:failed":
      return { icon: "x", color: "text-status-failed" };
    case "agent:idle":
      return { icon: "pause", color: "text-status-idle" };
    case "agent:suspended":
      return { icon: "pause", color: "text-status-suspended" };
    case "agent:resumed":
      return { icon: "play", color: "text-status-active" };
    case "agent:health":
      return { icon: "heart", color: "text-muted-foreground" };
    case "queue:enqueued":
      return { icon: "plus", color: "text-status-queued" };
    case "queue:drain":
      return { icon: "check", color: "text-status-completed" };
    case "system:budget-alert":
      return { icon: "x", color: "text-status-failed" };
    case "webhook:issue.created":
      return { icon: "plus", color: "text-status-queued" };
    case "webhook:comment.created":
      return { icon: "msg", color: "text-status-suspended" };
    default:
      return { icon: "arrow", color: "text-muted-foreground" };
  }
}

function EventIcon({ type }: { type: string }) {
  const { icon, color } = eventVisual(type);
  const iconMap: Record<IconKind, React.ReactNode> = {
    play: (
      <svg className="size-3.5" viewBox="0 0 16 16" fill="currentColor">
        <path d="M4 2.5v11l9-5.5z" />
      </svg>
    ),
    check: (
      <svg
        className="size-3.5"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <path d="M3 8.5l3.5 3.5 6.5-8" />
      </svg>
    ),
    x: (
      <svg
        className="size-3.5"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <path d="M4 4l8 8M12 4l-8 8" />
      </svg>
    ),
    pause: (
      <svg className="size-3.5" viewBox="0 0 16 16" fill="currentColor">
        <path d="M5 3h2v10H5zm4 0h2v10H9z" />
      </svg>
    ),
    plus: (
      <svg
        className="size-3.5"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <path d="M8 3v10M3 8h10" />
      </svg>
    ),
    arrow: (
      <svg
        className="size-3.5"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <path d="M3 8h10M9 4l4 4-4 4" />
      </svg>
    ),
    heart: (
      <svg className="size-3.5" viewBox="0 0 16 16" fill="currentColor">
        <path d="M8 14s-5.5-3.5-5.5-7.5C2.5 4 4.5 2.5 6.5 2.5c1.1 0 1.5.5 1.5.5s.4-.5 1.5-.5c2 0 4 1.5 4 4C13.5 10.5 8 14 8 14z" />
      </svg>
    ),
    msg: (
      <svg className="size-3.5" viewBox="0 0 16 16" fill="currentColor">
        <path d="M2 3h12v8H4l-2 2V3z" />
      </svg>
    ),
  };

  return (
    <span
      className={cn("flex size-6 items-center justify-center rounded-md bg-secondary", color)}
    >
      {iconMap[icon]}
    </span>
  );
}

interface ActivityItemProps {
  event: EventRow;
}

function describe(event: EventRow): string {
  if (event.detail) return event.detail;
  const parts: string[] = [];
  if (event.role) parts.push(event.role);
  parts.push(event.eventType);
  if (event.issueKey) parts.push(event.issueKey);
  return parts.join(" ");
}

export function ActivityItem({ event }: ActivityItemProps) {
  return (
    <div className="flex items-start gap-3 px-1 py-2">
      <EventIcon type={event.eventType} />
      <div className="min-w-0 flex-1">
        <p className="text-sm leading-snug">{describe(event)}</p>
        <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
          <span>{formatRelativeTime(event.createdAt)}</span>
          {event.role && (
            <>
              <span className="text-border">|</span>
              <span className="capitalize">{event.role}</span>
            </>
          )}
          {event.issueKey && (
            <>
              <span className="text-border">|</span>
              <span className="font-mono">{event.issueKey}</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
