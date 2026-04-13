"use client";

import { useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

interface KeyboardLegendProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface Shortcut {
  keys: string[];
  label: string;
}

interface Section {
  title: string;
  items: Shortcut[];
}

const SECTIONS: Section[] = [
  {
    title: "Navigation",
    items: [
      { keys: ["g", "i"], label: "Go to Inbox" },
      { keys: ["g", "t"], label: "Go to Tasks" },
      { keys: ["g", "p"], label: "Go to Projects" },
      { keys: ["g", "m"], label: "Go to Members" },
    ],
  },
  {
    title: "Sidebar",
    items: [{ keys: ["⌘", "\\"], label: "Toggle sidebar" }],
  },
  {
    title: "Search",
    items: [
      { keys: ["/"], label: "Focus search box" },
      { keys: ["⌘", "K"], label: "Open command palette" },
    ],
  },
  {
    title: "Tasks rail",
    items: [
      { keys: ["j"], label: "Move down" },
      { keys: ["k"], label: "Move up" },
      { keys: ["x"], label: "Toggle select" },
      { keys: ["⇧", "j"], label: "Extend selection down" },
      { keys: ["⇧", "k"], label: "Extend selection up" },
      { keys: ["s"], label: "Change status" },
      { keys: ["p"], label: "Change priority" },
      { keys: ["l"], label: "Change label" },
      { keys: ["↵"], label: "Open task" },
      { keys: ["Esc"], label: "Clear selection" },
    ],
  },
  {
    title: "Inbox",
    items: [
      { keys: ["j"], label: "Next notification" },
      { keys: ["k"], label: "Previous notification" },
      { keys: ["m"], label: "Mark read" },
      { keys: ["e"], label: "Archive" },
      { keys: ["r"], label: "Focus reply" },
      { keys: ["↵"], label: "Open linked task" },
    ],
  },
  {
    title: "Help",
    items: [{ keys: ["?"], label: "Show this legend" }],
  },
];

export function totalShortcutCount(): number {
  return SECTIONS.reduce((acc, s) => acc + s.items.length, 0);
}

export function KeyboardLegend({ open, onOpenChange }: KeyboardLegendProps) {
  // ⌘K closes the legend (the palette will reopen via its own listener)
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        onOpenChange(false);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            Press <Kbd>?</Kbd> any time to bring this back up.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-6 py-2 sm:grid-cols-2">
          {SECTIONS.map((section) => (
            <div key={section.title}>
              <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                {section.title}
              </h3>
              <ul className="space-y-1.5">
                {section.items.map((item, idx) => (
                  <li
                    key={idx}
                    className="flex items-center justify-between gap-3 text-[12px]"
                  >
                    <span className="text-foreground/80">{item.label}</span>
                    <span className="flex shrink-0 items-center gap-1">
                      {item.keys.map((k, i) => (
                        <Kbd key={i}>{k}</Kbd>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-[20px] items-center justify-center rounded border border-border bg-secondary px-1.5 font-mono text-[10px] font-medium text-foreground">
      {children}
    </kbd>
  );
}

