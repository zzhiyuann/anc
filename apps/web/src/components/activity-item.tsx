import type { AncEvent, EventType } from "@/lib/types";
import { cn } from "@/lib/utils";

const eventIcons: Record<EventType, { icon: string; color: string }> = {
  "agent.started": { icon: "play", color: "text-status-active" },
  "agent.completed": { icon: "check", color: "text-status-completed" },
  "agent.failed": { icon: "x", color: "text-status-failed" },
  "agent.idle": { icon: "pause", color: "text-status-idle" },
  "task.created": { icon: "plus", color: "text-status-queued" },
  "task.assigned": { icon: "arrow", color: "text-status-completed" },
  "task.completed": { icon: "check", color: "text-status-active" },
  "system.health": { icon: "heart", color: "text-muted-foreground" },
  "message.sent": { icon: "msg", color: "text-status-suspended" },
  "message.received": { icon: "msg", color: "text-status-completed" },
};

function formatRelativeTime(timestamp: string): string {
  const now = new Date("2026-04-11T11:30:00Z"); // mock "now" for consistent display
  const then = new Date(timestamp);
  const diffMs = now.getTime() - then.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffH = Math.floor(diffMin / 60);
  const diffD = Math.floor(diffH / 24);

  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffH < 24) return `${diffH}h ago`;
  return `${diffD}d ago`;
}

function EventIcon({ type }: { type: EventType }) {
  const config = eventIcons[type];
  const iconMap: Record<string, React.ReactNode> = {
    play: (
      <svg className="size-3.5" viewBox="0 0 16 16" fill="currentColor">
        <path d="M4 2.5v11l9-5.5z" />
      </svg>
    ),
    check: (
      <svg className="size-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M3 8.5l3.5 3.5 6.5-8" />
      </svg>
    ),
    x: (
      <svg className="size-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M4 4l8 8M12 4l-8 8" />
      </svg>
    ),
    pause: (
      <svg className="size-3.5" viewBox="0 0 16 16" fill="currentColor">
        <path d="M5 3h2v10H5zm4 0h2v10H9z" />
      </svg>
    ),
    plus: (
      <svg className="size-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M8 3v10M3 8h10" />
      </svg>
    ),
    arrow: (
      <svg className="size-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
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
    <span className={cn("flex size-6 items-center justify-center rounded-md bg-secondary", config.color)}>
      {iconMap[config.icon]}
    </span>
  );
}

interface ActivityItemProps {
  event: AncEvent;
}

export function ActivityItem({ event }: ActivityItemProps) {
  return (
    <div className="flex items-start gap-3 px-1 py-2">
      <EventIcon type={event.type} />
      <div className="min-w-0 flex-1">
        <p className="text-sm leading-snug">{event.message}</p>
        <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
          <span>{formatRelativeTime(event.timestamp)}</span>
          {event.agent && (
            <>
              <span className="text-border">|</span>
              <span className="capitalize">{event.agent}</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
