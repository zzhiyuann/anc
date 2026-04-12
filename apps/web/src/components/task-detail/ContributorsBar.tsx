"use client";

import type { SessionOnTask } from "@/lib/types";
import { agentInitial, cn } from "@/lib/utils";
import { roleAvatarClass } from "./role-colors";

interface ContributorsBarProps {
  sessions: SessionOnTask[];
  onPick?: (role: string) => void;
}

function dotClass(state: SessionOnTask["state"]) {
  switch (state) {
    case "active":
      return "bg-status-active animate-pulse";
    case "suspended":
      return "bg-status-suspended";
    default:
      return "bg-status-idle";
  }
}

export function ContributorsBar({ sessions, onPick }: ContributorsBarProps) {
  // Dedupe by role, prefer the most "active" session for each role.
  const byRole = new Map<string, SessionOnTask>();
  for (const s of sessions) {
    const existing = byRole.get(s.role);
    if (
      !existing ||
      (existing.state !== "active" && s.state === "active") ||
      (existing.state === "idle" && s.state === "suspended")
    ) {
      byRole.set(s.role, s);
    }
  }
  const list = [...byRole.values()];

  if (list.length === 0) {
    return (
      <span className="text-xs text-muted-foreground">No contributors yet</span>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      {list.map((s) => (
        <button
          key={s.role}
          type="button"
          onClick={() => onPick?.(s.role)}
          title={`${s.role} · ${s.state}`}
          className="group relative flex items-center"
        >
          <span
            className={cn(
              "flex size-7 items-center justify-center rounded-full text-xs font-semibold ring-1 ring-border transition-transform group-hover:scale-110",
              roleAvatarClass(s.role),
            )}
          >
            {agentInitial(s.role)}
          </span>
          <span
            className={cn(
              "absolute -bottom-0.5 -right-0.5 size-2 rounded-full ring-2 ring-background",
              dotClass(s.state),
            )}
          />
        </button>
      ))}
    </div>
  );
}
