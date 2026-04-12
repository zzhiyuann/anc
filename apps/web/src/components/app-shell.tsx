"use client";

import { useState } from "react";
import { Sidebar } from "./sidebar";
import { Header } from "./header";
import { CommandPalette, useCommandPalette } from "./command-palette";
import { useWebSocket } from "@/lib/use-websocket";

interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const { open: commandOpen, setOpen: setCommandOpen } = useCommandPalette();
  const { connected, lastMessage } = useWebSocket();

  return (
    <>
      <div className="flex h-screen overflow-hidden">
        <Sidebar
          collapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed((c) => !c)}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <Header
            connected={connected}
            onCommandPalette={() => setCommandOpen(true)}
            lastMessage={lastMessage}
          />
          <main className="flex-1 overflow-y-auto">
            {children}
          </main>
        </div>
      </div>
      <CommandPalette open={commandOpen} onOpenChange={setCommandOpen} />
    </>
  );
}
