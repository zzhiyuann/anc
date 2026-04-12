"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { ProjectWithStats } from "@/lib/types";
import { cn } from "@/lib/utils";

interface ProjectPickerProps {
  value: string | null;
  onChange: (projectId: string | null) => void;
  /** Show "All projects" instead of "No project" as the null option. */
  allOption?: boolean;
  className?: string;
  id?: string;
  disabled?: boolean;
  /** Optional pre-loaded project list (avoids extra fetch). */
  projects?: ProjectWithStats[];
}

/**
 * Lightweight project selector. Renders a styled native <select> so it
 * works in dialogs and forms without depending on a popover primitive.
 *
 * Each option is prefixed with the project icon. The selected color
 * is shown as a dot to the left of the control.
 */
export function ProjectPicker({
  value,
  onChange,
  allOption = false,
  className,
  id,
  disabled,
  projects: providedProjects,
}: ProjectPickerProps) {
  const [projects, setProjects] = useState<ProjectWithStats[]>(
    providedProjects ?? [],
  );
  const [loading, setLoading] = useState(!providedProjects);

  useEffect(() => {
    if (providedProjects) {
      setProjects(providedProjects);
      setLoading(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const list = await api.projects.list();
        if (!cancelled) setProjects(list.filter((p) => p.state !== "archived"));
      } catch {
        // Silent — picker is non-blocking.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [providedProjects]);

  const selected = projects.find((p) => p.id === value) ?? null;
  const accent = selected?.color ?? "#6b7280";
  const nullLabel = allOption ? "All projects" : "No project";

  return (
    <div className={cn("relative flex items-center gap-2", className)}>
      <span
        className="pointer-events-none absolute left-2.5 size-2.5 rounded-full"
        style={{ backgroundColor: selected ? accent : "transparent", border: selected ? "none" : "1px dashed currentColor" }}
        aria-hidden
      />
      <select
        id={id}
        disabled={disabled || loading}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
        className="flex h-9 w-full rounded-md border border-input bg-transparent pl-7 pr-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
      >
        <option value="">{loading ? "Loading…" : nullLabel}</option>
        {projects.map((p) => {
          const raw = p.icon ?? "📁";
          const ic = raw.length <= 2 ? raw : "📁";
          return (
            <option key={p.id} value={p.id}>
              {ic + "  " + p.name}
            </option>
          );
        })}
      </select>
    </div>
  );
}
