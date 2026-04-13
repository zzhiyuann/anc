"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import type { ProjectWithStats } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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

const NULL_TOKEN = "__none__";

/**
 * Project selector built on the shadcn-style Select primitive (Base UI).
 * Each option shows a colored dot + project icon + name.
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

  const nullLabel = allOption ? "All projects" : "No project";

  const items = useMemo(
    () => [
      { value: NULL_TOKEN, label: nullLabel },
      ...projects.map((p) => ({
        value: p.id,
        label: p.name,
      })),
    ],
    [projects, nullLabel],
  );

  const selected = projects.find((p) => p.id === value) ?? null;
  const accent = selected?.color ?? null;

  return (
    <Select<string>
      value={value ?? NULL_TOKEN}
      onValueChange={(v) => onChange(v === NULL_TOKEN ? null : v)}
      disabled={disabled || loading}
      items={items}
    >
      <SelectTrigger id={id} className={cn("w-full", className)}>
        <span className="flex min-w-0 items-center gap-2">
          <span
            aria-hidden
            className="inline-block size-2.5 shrink-0 rounded-full"
            style={{
              backgroundColor: accent ?? "transparent",
              border: accent ? "none" : "1px dashed currentColor",
            }}
          />
          <SelectValue placeholder={loading ? "Loading…" : nullLabel} />
        </span>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NULL_TOKEN}>
          <span className="flex items-center gap-2">
            <span
              aria-hidden
              className="inline-block size-2.5 rounded-full border border-dashed"
            />
            <span>{nullLabel}</span>
          </span>
        </SelectItem>
        {projects.map((p) => {
          const raw = p.icon ?? "📁";
          const ic = raw.length <= 2 ? raw : "📁";
          return (
            <SelectItem key={p.id} value={p.id}>
              <span className="flex items-center gap-2">
                <span
                  aria-hidden
                  className="inline-block size-2.5 rounded-full"
                  style={{ backgroundColor: p.color ?? "#6b7280" }}
                />
                <span className="text-[12px] opacity-80">{ic}</span>
                <span className="truncate">{p.name}</span>
              </span>
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}
