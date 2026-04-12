"use client";

import { cn } from "@/lib/utils";
import { NotificationBell } from "./inbox/notification-bell";
import type { WsMessage } from "@/lib/types";

interface HeaderProps {
  connected: boolean;
  onCommandPalette: () => void;
  lastMessage?: WsMessage | null;
}

export function Header({ connected, onCommandPalette, lastMessage }: HeaderProps) {
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
        <NotificationBell lastMessage={lastMessage} />

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
