"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
} from "@/components/ui/command";
import { tasks as tasksApi, projects as projectsApi } from "@/lib/api";
import type { Task, ProjectWithStats } from "@/lib/types";
import { useTheme } from "./theme-provider";

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenLegend?: () => void;
}

export function CommandPalette({ open, onOpenChange, onOpenLegend }: CommandPaletteProps) {
  const router = useRouter();
  const { toggle: toggleTheme } = useTheme();
  const [taskList, setTaskList] = useState<Task[]>([]);
  const [projectList, setProjectList] = useState<ProjectWithStats[]>([]);
  const [loaded, setLoaded] = useState(false);

  // Lazy-load search corpus the first time the palette opens.
  useEffect(() => {
    if (!open || loaded) return;
    let aborted = false;
    Promise.allSettled([tasksApi.list(), projectsApi.list()]).then(
      ([t, p]) => {
        if (aborted) return;
        if (t.status === "fulfilled") setTaskList(t.value);
        if (p.status === "fulfilled") setProjectList(p.value);
        setLoaded(true);
      },
    );
    return () => {
      aborted = true;
    };
  }, [open, loaded]);

  const runCommand = useCallback(
    (command: () => void) => {
      onOpenChange(false);
      command();
    },
    [onOpenChange],
  );

  // Cap result lists so cmdk filtering stays snappy.
  const visibleTasks = useMemo(() => taskList.slice(0, 50), [taskList]);
  const visibleProjects = useMemo(() => projectList.slice(0, 50), [projectList]);

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Type a command, search tasks or projects..." />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        <CommandGroup heading="Navigation">
          <CommandItem onSelect={() => runCommand(() => router.push("/inbox"))}>
            <InboxIcon />
            <span>Inbox</span>
          </CommandItem>
          <CommandItem onSelect={() => runCommand(() => router.push("/pulse"))}>
            <PulseIcon />
            <span>Dashboard</span>
          </CommandItem>
          <CommandItem onSelect={() => runCommand(() => router.push("/tasks"))}>
            <TaskIcon />
            <span>Tasks</span>
          </CommandItem>
          <CommandItem onSelect={() => runCommand(() => router.push("/projects"))}>
            <ProjectIcon />
            <span>Projects</span>
          </CommandItem>
          <CommandItem onSelect={() => runCommand(() => router.push("/members"))}>
            <MembersIcon />
            <span>Members</span>
          </CommandItem>
          <CommandItem onSelect={() => runCommand(() => router.push("/settings"))}>
            <SettingsIcon />
            <span>Settings</span>
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Actions">
          <CommandItem
            onSelect={() => runCommand(() => router.push("/tasks?new=1"))}
          >
            <PlusIcon />
            <span>Create new task</span>
          </CommandItem>
          <CommandItem
            onSelect={() => runCommand(() => router.push("/projects?new=1"))}
          >
            <PlusIcon />
            <span>Create new project</span>
          </CommandItem>
          <CommandItem onSelect={() => runCommand(() => toggleTheme())}>
            <ThemeIcon />
            <span>Toggle theme</span>
          </CommandItem>
          {onOpenLegend && (
            <CommandItem
              onSelect={() => runCommand(() => onOpenLegend())}
            >
              <HelpIcon />
              <span>Keyboard shortcuts</span>
            </CommandItem>
          )}
        </CommandGroup>

        {visibleTasks.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Tasks">
              {visibleTasks.map((t) => (
                <CommandItem
                  key={`task-${t.id}`}
                  value={`task ${t.id} ${t.title}`}
                  onSelect={() =>
                    runCommand(() => router.push(`/tasks?task=${encodeURIComponent(t.id)}`))
                  }
                >
                  <TaskIcon />
                  <span className="truncate">{t.title}</span>
                  <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                    {t.id.slice(0, 8)}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        {visibleProjects.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Projects">
              {visibleProjects.map((p) => (
                <CommandItem
                  key={`project-${p.id}`}
                  value={`project ${p.id} ${p.name}`}
                  onSelect={() =>
                    runCommand(() => router.push(`/projects/${encodeURIComponent(p.id)}`))
                  }
                >
                  <ProjectIcon />
                  <span className="truncate">{p.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}

// ---- icons ----

function InboxIcon() {
  return (
    <svg className="size-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M2 9l2-5h8l2 5M2 9v3a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V9M2 9h3l1 2h4l1-2h3" />
    </svg>
  );
}
function TaskIcon() {
  return (
    <svg className="size-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="2" y="2" width="12" height="12" rx="2" />
      <path d="M5 8l2 2 4-4" />
    </svg>
  );
}
function ProjectIcon() {
  return (
    <svg className="size-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M2 5a2 2 0 0 1 2-2h2.5l1.5 1.5H12a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5z" />
    </svg>
  );
}
function PulseIcon() {
  return (
    <svg className="size-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M2 8h3l2-5 2 10 2-5h3" />
    </svg>
  );
}
function MembersIcon() {
  return (
    <svg className="size-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="6" cy="6" r="2.2" />
      <circle cx="11" cy="7" r="1.8" />
      <path d="M2 13c0-2.2 1.8-3.5 4-3.5s4 1.3 4 3.5M9 13c0-1.7 1.2-2.7 3-2.7s2 1 2 2.7" />
    </svg>
  );
}
function SettingsIcon() {
  return (
    <svg className="size-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="8" cy="8" r="2" />
      <path d="M8 2v2M8 12v2M2 8h2M12 8h2M3.8 3.8l1.4 1.4M10.8 10.8l1.4 1.4M3.8 12.2l1.4-1.4M10.8 5.2l1.4-1.4" />
    </svg>
  );
}
function PlusIcon() {
  return (
    <svg className="size-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M8 3v10M3 8h10" />
    </svg>
  );
}
function ThemeIcon() {
  return (
    <svg className="size-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M13 9.5A6 6 0 1 1 6.5 3a5 5 0 0 0 6.5 6.5z" />
    </svg>
  );
}
function HelpIcon() {
  return (
    <svg className="size-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="8" cy="8" r="6" />
      <path d="M6.5 6a1.5 1.5 0 1 1 2.2 1.3c-.5.3-.7.7-.7 1.2M8 11h.01" />
    </svg>
  );
}

// Hook for ⌘K binding
export function useCommandPalette() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  return { open, setOpen };
}
