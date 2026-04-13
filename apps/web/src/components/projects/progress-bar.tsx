import { cn } from "@/lib/utils";

interface ProgressBarProps {
  /** 0..100 */
  value: number;
  className?: string;
}

export function ProgressBar({ value, className }: ProgressBarProps) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  const color =
    pct >= 80
      ? "bg-status-active"
      : pct >= 40
        ? "bg-status-queued"
        : "bg-muted-foreground/60";
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className="h-1 w-16 overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-8 text-right font-mono text-[11px] tabular-nums text-muted-foreground">
        {pct}%
      </span>
    </div>
  );
}
