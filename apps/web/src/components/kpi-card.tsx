import { cn } from "@/lib/utils";

interface KpiCardProps {
  label: string;
  value: string | number;
  detail?: string;
  trend?: "up" | "down" | "neutral";
  trendValue?: string;
  icon?: React.ReactNode;
  className?: string;
}

export function KpiCard({
  label,
  value,
  detail,
  trend,
  trendValue,
  icon,
  className,
}: KpiCardProps) {
  return (
    <div
      className={cn(
        "flex flex-col rounded-xl border border-border bg-card p-5",
        className
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        {icon && (
          <span className="text-muted-foreground">{icon}</span>
        )}
      </div>
      <div className="mt-3 flex items-baseline gap-2">
        <span className="text-3xl font-semibold tracking-tight">{value}</span>
        {trend && trendValue && (
          <span
            className={cn(
              "text-xs font-medium",
              trend === "up" && "text-status-active",
              trend === "down" && "text-status-failed",
              trend === "neutral" && "text-muted-foreground"
            )}
          >
            {trend === "up" ? "+" : trend === "down" ? "-" : ""}
            {trendValue}
          </span>
        )}
      </div>
      {detail && (
        <span className="mt-1 text-xs text-muted-foreground">{detail}</span>
      )}
    </div>
  );
}
