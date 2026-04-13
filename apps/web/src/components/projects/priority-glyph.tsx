import { cn } from "@/lib/utils";

interface PriorityGlyphProps {
  priority: number;
  className?: string;
}

/**
 * Linear-style 3-bar priority glyph. Higher numbers = lower urgency.
 * Mapping mirrors lib/utils.ts priorityLabel:
 *   1 = CEO / Critical (3 bars + dot)
 *   2 = Urgent (3 bars)
 *   3 = High (2 bars)
 *   4 = Normal (1 bar)
 *   5 = Low (0 bars / muted)
 */
export function PriorityGlyph({ priority, className }: PriorityGlyphProps) {
  const filled =
    priority === 1 ? 3 : priority === 2 ? 3 : priority === 3 ? 2 : priority === 4 ? 1 : 0;
  const tint =
    priority === 1
      ? "bg-status-failed"
      : priority === 2
        ? "bg-status-queued"
        : "bg-foreground/80";
  return (
    <div
      className={cn("inline-flex items-end gap-[2px]", className)}
      aria-label={`Priority ${priority}`}
    >
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className={cn(
            "w-[3px] rounded-[1px]",
            i === 0 ? "h-[5px]" : i === 1 ? "h-[8px]" : "h-[11px]",
            i < filled ? tint : "bg-muted",
          )}
        />
      ))}
    </div>
  );
}

export const PRIORITY_OPTIONS: { value: number; label: string }[] = [
  { value: 1, label: "Critical" },
  { value: 2, label: "Urgent" },
  { value: 3, label: "High" },
  { value: 4, label: "Normal" },
  { value: 5, label: "Low" },
];
