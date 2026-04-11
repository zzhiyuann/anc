"use client";

import { cn } from "@/lib/utils";

interface HeaderProps {
  connected: boolean;
  onCommandPalette: () => void;
}

export function Header({ connected, onCommandPalette }: HeaderProps) {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-background/80 px-6 backdrop-blur-sm">
      <div className="flex items-center gap-4">
        {/* Breadcrumb placeholder */}
        <h1 className="text-sm font-medium text-foreground/80">Dashboard</h1>
      </div>

      <div className="flex items-center gap-3">
        {/* Command palette trigger */}
        <button
          onClick={onCommandPalette}
          className="flex items-center gap-2 rounded-lg border border-border bg-secondary/50 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <svg className="size-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="7" cy="7" r="4" />
            <path d="M10 10l3 3" />
          </svg>
          <span>Search...</span>
          <kbd className="ml-2 rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[10px]">
            ⌘K
          </kbd>
        </button>

        {/* Notifications */}
        <button className="relative rounded-lg p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground">
          <svg className="size-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M8 2a4 4 0 0 0-4 4v2l-1 2h10l-1-2V6a4 4 0 0 0-4-4zM6.5 12.5a1.5 1.5 0 0 0 3 0" />
          </svg>
          <span className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-status-active" />
        </button>

        {/* Connection status */}
        <div
          className={cn(
            "flex items-center gap-1.5 rounded-md px-2 py-1 text-xs",
            connected
              ? "bg-status-active/10 text-status-active"
              : "bg-status-failed/10 text-status-failed"
          )}
        >
          <span
            className={cn(
              "size-1.5 rounded-full",
              connected ? "bg-status-active" : "bg-status-failed"
            )}
          />
          {connected ? "Connected" : "Disconnected"}
        </div>
      </div>
    </header>
  );
}
