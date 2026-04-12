import Link from "next/link";
import type { AgentStatus } from "@/lib/types";
import { StatusBadge } from "./status-badge";
import {
  agentInitial,
  cn,
  deriveAgentStatus,
  formatUptime,
  primaryActiveSession,
} from "@/lib/utils";

interface AgentCardProps {
  agent: AgentStatus;
  compact?: boolean;
  memoryCount?: number;
}

const avatarColors: Record<string, string> = {
  engineer: "bg-blue-500/20 text-blue-400",
  strategist: "bg-purple-500/20 text-purple-400",
  ops: "bg-amber-500/20 text-amber-400",
};

export function AgentCard({ agent, compact = false, memoryCount }: AgentCardProps) {
  const status = deriveAgentStatus(agent);
  const active = primaryActiveSession(agent);
  const activeTask = active?.issueKey ?? null;
  const uptime = active?.uptime ?? 0;
  const totalSessions =
    agent.activeSessions + agent.idleSessions + agent.suspendedSessions;

  if (compact) {
    return (
      <Link
        href={`/agents/${agent.role}`}
        className="flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-secondary/60"
      >
        <div
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-lg text-sm font-semibold",
            avatarColors[agent.role] ?? "bg-muted text-muted-foreground",
          )}
        >
          {agentInitial(agent.role)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{agent.name}</span>
            <StatusBadge status={status} />
          </div>
          <p className="truncate text-xs text-muted-foreground">
            {activeTask
              ? `Working on ${activeTask}`
              : status === "idle"
                ? "Ready for assignment"
                : "No active task"}
          </p>
        </div>
        <span className="shrink-0 font-mono text-xs text-muted-foreground">
          {formatUptime(uptime)}
        </span>
      </Link>
    );
  }

  return (
    <Link
      href={`/agents/${agent.role}`}
      className="group flex flex-col rounded-xl border border-border bg-card p-5 transition-all hover:border-border/80 hover:bg-card/80"
    >
      <div className="flex items-start justify-between">
        <div
          className={cn(
            "flex size-11 items-center justify-center rounded-xl text-lg font-bold",
            avatarColors[agent.role] ?? "bg-muted text-muted-foreground",
          )}
        >
          {agentInitial(agent.role)}
        </div>
        <StatusBadge status={status} />
      </div>

      <div className="mt-4">
        <h3 className="text-base font-semibold">{agent.name}</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {agent.activeSessions}/{agent.maxConcurrency} active
        </p>
      </div>

      <p className="mt-3 line-clamp-2 text-sm text-muted-foreground">
        {activeTask
          ? `Working on ${activeTask}`
          : "Awaiting next assignment"}
      </p>

      <div className="mt-4 flex items-center gap-4 border-t border-border pt-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <svg className="size-3.5" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0zm0 14.5a6.5 6.5 0 1 1 0-13 6.5 6.5 0 0 1 0 13zM8 3a.75.75 0 0 1 .75.75v3.69l2.28 2.28a.75.75 0 1 1-1.06 1.06l-2.5-2.5A.75.75 0 0 1 7.25 8V3.75A.75.75 0 0 1 8 3z" />
          </svg>
          {formatUptime(uptime)}
        </span>
        {memoryCount != null && <span>{memoryCount} memories</span>}
        <span>{totalSessions} sessions</span>
      </div>
    </Link>
  );
}
