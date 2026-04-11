"use client";

import { useEffect, useState, useCallback } from "react";
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

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const router = useRouter();

  const runCommand = useCallback(
    (command: () => void) => {
      onOpenChange(false);
      command();
    },
    [onOpenChange]
  );

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Type a command or search..." />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        <CommandGroup heading="Navigation">
          <CommandItem
            onSelect={() => runCommand(() => router.push("/"))}
          >
            <LayoutIcon />
            <span>Command Center</span>
          </CommandItem>
          <CommandItem
            onSelect={() => runCommand(() => router.push("/tasks"))}
          >
            <TaskIcon />
            <span>Tasks</span>
          </CommandItem>
          <CommandItem
            onSelect={() => runCommand(() => router.push("/agents"))}
          >
            <AgentIcon />
            <span>Agents</span>
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Agents">
          <CommandItem
            onSelect={() =>
              runCommand(() => router.push("/agents/engineer"))
            }
          >
            <span className="flex size-5 items-center justify-center rounded bg-blue-500/20 text-xs text-blue-400">
              E
            </span>
            <span>Engineer</span>
          </CommandItem>
          <CommandItem
            onSelect={() =>
              runCommand(() => router.push("/agents/strategist"))
            }
          >
            <span className="flex size-5 items-center justify-center rounded bg-purple-500/20 text-xs text-purple-400">
              S
            </span>
            <span>Strategist</span>
          </CommandItem>
          <CommandItem
            onSelect={() => runCommand(() => router.push("/agents/ops"))}
          >
            <span className="flex size-5 items-center justify-center rounded bg-amber-500/20 text-xs text-amber-400">
              O
            </span>
            <span>Ops</span>
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Actions">
          <CommandItem onSelect={() => runCommand(() => {})}>
            <PlusIcon />
            <span>Create Task</span>
          </CommandItem>
          <CommandItem onSelect={() => runCommand(() => {})}>
            <RefreshIcon />
            <span>Refresh Status</span>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}

// Minimal inline SVG icons to avoid extra imports
function LayoutIcon() {
  return (
    <svg className="size-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="2" y="2" width="12" height="12" rx="2" />
      <path d="M2 6h12M6 6v8" />
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

function AgentIcon() {
  return (
    <svg className="size-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="8" cy="5" r="3" />
      <path d="M3 14c0-2.8 2.2-5 5-5s5 2.2 5 5" />
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

function RefreshIcon() {
  return (
    <svg className="size-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M13 8A5 5 0 1 1 8 3M13 3v5h-5" />
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
