"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronUp, MoreHorizontal } from "lucide-react";
import type { AgentStatus } from "@/lib/types";
import { agentInitial, cn, deriveAgentStatus, formatRelativeTime } from "@/lib/utils";
import { api } from "@/lib/api";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const AVATAR_COLORS: Record<string, string> = {
  engineer: "bg-blue-500/20 text-blue-300",
  strategist: "bg-purple-500/20 text-purple-300",
  ops: "bg-amber-500/20 text-amber-300",
  "ceo-office": "bg-emerald-500/20 text-emerald-300",
};

const FALLBACK_PALETTE = [
  "bg-rose-500/20 text-rose-300",
  "bg-cyan-500/20 text-cyan-300",
  "bg-fuchsia-500/20 text-fuchsia-300",
  "bg-lime-500/20 text-lime-300",
  "bg-sky-500/20 text-sky-300",
];

function colorFor(role: string): string {
  if (AVATAR_COLORS[role]) return AVATAR_COLORS[role];
  let hash = 0;
  for (let i = 0; i < role.length; i++) hash = (hash * 31 + role.charCodeAt(i)) | 0;
  return FALLBACK_PALETTE[Math.abs(hash) % FALLBACK_PALETTE.length];
}

export interface MemberRow {
  agent: AgentStatus;
  joinedMs: number;
  memoryCount: number;
  lastSeenMs: number | null;
}

interface MembersTableProps {
  rows: MemberRow[];
  onEditPersona: (role: string) => void;
  onArchive: (role: string) => void;
}

type SortKey = "name" | "joined" | "lastSeen";
type SortDir = "asc" | "desc";

export function MembersTable({ rows, onEditPersona, onArchive }: MembersTableProps) {
  const router = useRouter();
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "name") {
        cmp = a.agent.name.localeCompare(b.agent.name);
      } else if (sortKey === "joined") {
        cmp = a.joinedMs - b.joinedMs;
      } else {
        cmp = (a.lastSeenMs ?? 0) - (b.lastSeenMs ?? 0);
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [rows, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-border bg-secondary/30 text-[11px] uppercase tracking-wide text-muted-foreground">
            <SortableTh
              label="Name"
              active={sortKey === "name"}
              dir={sortDir}
              onClick={() => toggleSort("name")}
            />
            <th className="px-4 py-2 text-left font-medium">Status</th>
            <SortableTh
              label="Joined"
              active={sortKey === "joined"}
              dir={sortDir}
              onClick={() => toggleSort("joined")}
            />
            <th className="px-4 py-2 text-left font-medium">Teams</th>
            <SortableTh
              label="Last seen"
              active={sortKey === "lastSeen"}
              dir={sortDir}
              onClick={() => toggleSort("lastSeen")}
            />
            <th className="px-4 py-2 text-left font-medium">Memory</th>
            <th className="px-4 py-2 text-left font-medium">Active sessions</th>
            <th className="w-10 px-2 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 && (
            <tr>
              <td
                colSpan={8}
                className="px-4 py-12 text-center text-muted-foreground"
              >
                No members match your search.
              </td>
            </tr>
          )}
          {sorted.map(({ agent, joinedMs, lastSeenMs, memoryCount }) => {
            const status = deriveAgentStatus(agent);
            const statusLabel =
              status === "active" ? "Online" : status === "suspended" ? "Idle" : "Idle";
            const statusDot =
              status === "active" ? "bg-status-active" : "bg-status-idle";
            return (
              <tr
                key={agent.role}
                className="group cursor-pointer border-b border-border last:border-b-0 transition-colors hover:bg-secondary/40"
                onClick={() => router.push(`/agents/${agent.role}`)}
              >
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div
                      className={cn(
                        "flex size-8 shrink-0 items-center justify-center rounded-md text-sm font-semibold",
                        colorFor(agent.role),
                      )}
                    >
                      {agentInitial(agent.role)}
                    </div>
                    <div className="min-w-0">
                      <div className="font-medium leading-tight">{agent.name}</div>
                      <div className="text-[11px] text-muted-foreground leading-tight">
                        @{agent.role}
                      </div>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary/60 px-2 py-0.5 text-[11px]">
                    <span className={cn("size-1.5 rounded-full", statusDot)} />
                    {statusLabel}
                  </span>
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {new Date(joinedMs).toLocaleDateString("en-US", {
                    month: "short",
                    year: "numeric",
                  })}
                </td>
                <td className="px-4 py-3">
                  <span className="inline-flex items-center rounded-md border border-border bg-secondary/40 px-1.5 py-0.5 text-[11px]">
                    ANC
                  </span>
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {lastSeenMs ? formatRelativeTime(lastSeenMs) : "—"}
                </td>
                <td className="px-4 py-3 font-mono text-[12px] text-muted-foreground">
                  {memoryCount}
                </td>
                <td className="px-4 py-3 font-mono text-[12px]">
                  {agent.activeSessions}
                </td>
                <td
                  className="px-2 py-3"
                  onClick={(e) => e.stopPropagation()}
                >
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      className="rounded-md p-1 text-muted-foreground opacity-0 transition group-hover:opacity-100 hover:bg-secondary/70 hover:text-foreground"
                      aria-label="Member actions"
                    >
                      <MoreHorizontal className="size-4" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => onEditPersona(agent.role)}>
                        Edit persona
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => {
                          api.personas.suggest(agent.role).catch(() => {});
                          onEditPersona(agent.role);
                        }}
                      >
                        Suggest improvements
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => onArchive(agent.role)}>
                        Archive
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <noscript>
        <Link href="/agents" className="block p-4 text-center text-xs text-muted-foreground">
          View agents
        </Link>
      </noscript>
    </div>
  );
}

function SortableTh({
  label,
  active,
  dir,
  onClick,
}: {
  label: string;
  active: boolean;
  dir: SortDir;
  onClick: () => void;
}) {
  return (
    <th className="px-4 py-2 text-left font-medium">
      <button
        type="button"
        onClick={onClick}
        className="inline-flex items-center gap-1 text-[11px] uppercase tracking-wide text-muted-foreground hover:text-foreground"
      >
        {label}
        {active &&
          (dir === "asc" ? (
            <ChevronUp className="size-3" />
          ) : (
            <ChevronDown className="size-3" />
          ))}
      </button>
    </th>
  );
}
