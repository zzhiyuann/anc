"use client";

/**
 * SessionsTab — table of every session the agent currently has tracked
 * (active / idle / suspended). Real data from AgentStatusDetail.sessions.
 *
 * Backend gap: `AgentStatusDetail.sessions` only includes sessions still
 * tracked in-memory by runtime/health.ts. Historical sessions that have
 * already exited are not exposed via the agents API today. Documented in
 * the report.
 */

import Link from "next/link";
import type { AgentStatusDetail } from "@/lib/types";
import { StatusBadge } from "@/components/status-badge";
import { formatUptime } from "@/lib/utils";

interface SessionsTabProps {
  detail: AgentStatusDetail;
}

export function SessionsTab({ detail }: SessionsTabProps) {
  if (detail.sessions.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-10 text-center">
        <p className="text-sm text-muted-foreground">
          No sessions yet · dispatch a task to spawn one.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-border bg-secondary/30 text-[11px] uppercase tracking-wide text-muted-foreground">
            <th className="px-4 py-2 text-left font-medium">Issue</th>
            <th className="px-4 py-2 text-left font-medium">State</th>
            <th className="px-4 py-2 text-left font-medium">Uptime</th>
            <th className="px-4 py-2 text-left font-medium">Tmux</th>
          </tr>
        </thead>
        <tbody>
          {detail.sessions.map((s) => (
            <tr
              key={s.issueKey}
              className="border-b border-border last:border-b-0 hover:bg-secondary/30"
            >
              <td className="px-4 py-3 font-mono text-[12px]">
                <Link
                  href={`/tasks?task=${encodeURIComponent(s.issueKey)}`}
                  className="hover:underline"
                >
                  {s.issueKey}
                </Link>
              </td>
              <td className="px-4 py-3">
                <StatusBadge status={s.state} />
              </td>
              <td className="px-4 py-3 font-mono text-[12px] text-muted-foreground">
                {formatUptime(s.uptime)}
              </td>
              <td className="px-4 py-3 font-mono text-[11px] text-muted-foreground">
                anc-{detail.role}-{s.issueKey}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
