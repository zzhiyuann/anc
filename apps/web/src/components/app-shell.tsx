"use client";

import { useEffect, useState } from "react";
import { Sidebar } from "./sidebar";
import { Header } from "./header";
import { CommandPalette, useCommandPalette } from "./command-palette";
import { KeyboardLegend } from "./keyboard-legend";
import { useWebSocket } from "@/lib/use-websocket";

interface AppShellProps {
  children: React.ReactNode;
}

const STORAGE_KEY = "anc-sidebar-collapsed";

export function AppShell({ children }: AppShellProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [legendOpen, setLegendOpen] = useState(false);
  const { open: commandOpen, setOpen: setCommandOpen } = useCommandPalette();
  const { connected, lastMessage } = useWebSocket();

  // `?` opens the keyboard legend (skip when typing in inputs)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "?") return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if ((e.target as HTMLElement | null)?.isContentEditable) return;
      e.preventDefault();
      setLegendOpen((o) => !o);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Restore persisted collapsed state
  useEffect(() => {
    try {
      const v = localStorage.getItem(STORAGE_KEY);
      if (v === "1") setSidebarCollapsed(true);
    } catch {
      // ignore
    }
  }, []);

  // Persist on change
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, sidebarCollapsed ? "1" : "0");
    } catch {
      // ignore
    }
  }, [sidebarCollapsed]);

  // ⌘\ shortcut
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "\\") {
        e.preventDefault();
        setSidebarCollapsed((c) => !c);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const toggleSidebar = () => setSidebarCollapsed((c) => !c);

  return (
    <>
      <div className="flex h-screen overflow-hidden">
        <Sidebar
          collapsed={sidebarCollapsed}
          onToggle={toggleSidebar}
          onOpenLegend={() => setLegendOpen(true)}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <Header
            connected={connected}
            onCommandPalette={() => setCommandOpen(true)}
            onToggleSidebar={toggleSidebar}
            lastMessage={lastMessage}
          />
          <main className="flex-1 overflow-y-auto">{children}</main>
        </div>
      </div>
      <CommandPalette
        open={commandOpen}
        onOpenChange={setCommandOpen}
        onOpenLegend={() => setLegendOpen(true)}
      />
      <KeyboardLegend open={legendOpen} onOpenChange={setLegendOpen} />
    </>
  );
}
