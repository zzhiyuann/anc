import Link from "next/link";
import type { ProjectWithStats } from "@/lib/types";
import { cn, formatRelativeTime } from "@/lib/utils";

interface ProjectCardProps {
  project: ProjectWithStats;
  compact?: boolean;
  onClick?: () => void;
}

function fmtUsd(usd: number): string {
  if (usd === 0) return "$0";
  if (usd < 0.01) return "<$0.01";
  return `$${usd.toFixed(2)}`;
}

export function ProjectCard({ project, compact = false, onClick }: ProjectCardProps) {
  const accent = project.color || "#6b7280";
  const rawIcon = project.icon ?? "📁";
  const icon = rawIcon.length <= 2 ? rawIcon : "📁";
  const archived = project.state === "archived";

  if (compact) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="flex w-full items-center gap-2.5 rounded-lg border border-border bg-card px-3 py-2 text-left transition-colors hover:bg-secondary/60"
      >
        <span
          className="size-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: accent }}
        />
        <span className="text-base leading-none">{icon}</span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {project.name}
        </span>
        <span className="shrink-0 font-mono text-xs text-muted-foreground">
          {project.stats.total}
        </span>
      </button>
    );
  }

  const inner = (
    <>
      {/* Color accent strip */}
      <div
        className="absolute inset-x-0 top-0 h-1 rounded-t-xl"
        style={{ backgroundColor: accent }}
        aria-hidden
      />
      {/* Subtle glow on hover */}
      <div
        className="pointer-events-none absolute inset-0 rounded-xl opacity-0 transition-opacity group-hover:opacity-100"
        style={{
          background: `radial-gradient(120% 80% at 0% 0%, ${accent}1a, transparent 60%)`,
        }}
        aria-hidden
      />

      <div className="relative flex items-start justify-between">
        <div
          className="flex size-11 items-center justify-center rounded-xl text-2xl"
          style={{
            backgroundColor: `${accent}1f`,
            boxShadow: `inset 0 0 0 1px ${accent}33`,
          }}
        >
          {icon}
        </div>
        {archived && (
          <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase text-muted-foreground">
            Archived
          </span>
        )}
      </div>

      <div className="relative mt-4">
        <h3 className="text-base font-semibold tracking-tight">{project.name}</h3>
        <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
          {project.description || "No description"}
        </p>
      </div>

      <div className="relative mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span className="flex items-center gap-1 text-muted-foreground">
          <span className="size-1.5 rounded-full bg-status-active" />
          <span className="font-mono text-foreground">{project.stats.running}</span>
          running
        </span>
        <span className="flex items-center gap-1 text-muted-foreground">
          <span className="size-1.5 rounded-full bg-status-idle" />
          <span className="font-mono text-foreground">{project.stats.queued}</span>
          queued
        </span>
        <span className="flex items-center gap-1 text-muted-foreground">
          <span className="size-1.5 rounded-full bg-emerald-500" />
          <span className="font-mono text-foreground">{project.stats.done}</span>
          done
        </span>
      </div>

      <div className="relative mt-4 flex items-center justify-between border-t border-border pt-3 text-xs text-muted-foreground">
        <span className="font-mono text-foreground">
          {fmtUsd(project.stats.totalCostUsd)}
        </span>
        <span>{formatRelativeTime(project.createdAt)}</span>
      </div>
    </>
  );

  const className = cn(
    "group relative flex flex-col rounded-xl border border-border bg-card p-5 pt-6 transition-all hover:border-border/60 hover:shadow-lg hover:shadow-black/20",
    archived && "opacity-70",
  );

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={cn(className, "text-left")}>
        {inner}
      </button>
    );
  }

  return (
    <Link href={`/projects/${project.id}`} className={className}>
      {inner}
    </Link>
  );
}
