"use client";

import { useEffect, useRef, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TerminalOutput } from "@/components/terminal-output";
import { api } from "@/lib/api";
import type { SessionOnTask } from "@/lib/types";
import { cn } from "@/lib/utils";

interface LiveTerminalTabsProps {
  taskId: string;
  sessions: SessionOnTask[];
  /** Controlled active role (for click-from-contributor-bar). */
  activeRole?: string;
  onActiveRoleChange?: (role: string) => void;
}

export function LiveTerminalTabs({
  taskId,
  sessions,
  activeRole,
  onActiveRoleChange,
}: LiveTerminalTabsProps) {
  // Dedupe sessions by role.
  const seen = new Set<string>();
  const tabs = sessions.filter((s) => {
    if (seen.has(s.role)) return false;
    seen.add(s.role);
    return true;
  });

  const [internalRole, setInternalRole] = useState<string>(
    activeRole ?? tabs[0]?.role ?? "",
  );
  const role = activeRole ?? internalRole;

  useEffect(() => {
    if (activeRole) setInternalRole(activeRole);
  }, [activeRole]);

  const setRole = (r: string) => {
    setInternalRole(r);
    onActiveRoleChange?.(r);
  };

  if (tabs.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-card/50 p-8 text-center text-sm text-muted-foreground">
        No agent sessions on this task yet. Click <span className="font-medium text-foreground">Dispatch</span> to attach one.
      </div>
    );
  }

  return (
    <div>
      <Tabs value={role} onValueChange={setRole}>
        <TabsList>
          {tabs.map((s) => (
            <TabsTrigger key={s.role} value={s.role}>
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  s.state === "active" && "bg-status-active animate-pulse",
                  s.state === "idle" && "bg-status-idle",
                  s.state === "suspended" && "bg-status-suspended",
                )}
              />
              <span className="ml-1.5 capitalize">{s.role}</span>
            </TabsTrigger>
          ))}
        </TabsList>

        {tabs.map((s) => (
          <TabsContent key={s.role} value={s.role} className="mt-3">
            <SessionTerminal
              taskId={taskId}
              role={s.role}
              alive={s.alive && s.state === "active"}
            />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

function SessionTerminal({
  taskId,
  role,
  alive,
}: {
  taskId: string;
  role: string;
  alive: boolean;
}) {
  const [lines, setLines] = useState<string[]>(["(loading...)"]);
  const cancelRef = useRef(false);

  useEffect(() => {
    cancelRef.current = false;
    let stop = false;

    const fetchOnce = async () => {
      try {
        const next = await api.tasks.output(taskId, role, 200);
        if (stop || cancelRef.current) return;
        setLines(next.length > 0 ? next : ["(idle — no output yet)"]);
      } catch {
        if (!stop) setLines(["(unable to load tmux output)"]);
      }
    };

    void fetchOnce();
    const interval = alive ? 2000 : 5000;
    const timer = setInterval(fetchOnce, interval);
    return () => {
      stop = true;
      cancelRef.current = true;
      clearInterval(timer);
    };
  }, [taskId, role, alive]);

  return <TerminalOutput lines={lines} className="h-[360px]" />;
}
