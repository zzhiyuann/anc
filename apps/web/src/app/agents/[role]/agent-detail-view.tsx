"use client";

import { useState } from "react";
import Link from "next/link";
import { StatusBadge } from "@/components/status-badge";
import { TerminalOutput } from "@/components/terminal-output";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, ApiError } from "@/lib/api";
import {
  agentInitial,
  cn,
  deriveAgentStatus,
  formatUptime,
  primaryActiveSession,
} from "@/lib/utils";
import type { AgentOutput, AgentStatusDetail } from "@/lib/types";

const avatarColors: Record<string, string> = {
  engineer: "bg-blue-500/20 text-blue-400",
  strategist: "bg-purple-500/20 text-purple-400",
  ops: "bg-amber-500/20 text-amber-400",
};

interface AgentDetailViewProps {
  role: string;
  detail: AgentStatusDetail;
  outputs: AgentOutput[];
  memoryFiles: string[];
  live: boolean;
}

function joinOutputs(outputs: AgentOutput[]): string[] {
  if (outputs.length === 0) {
    return ["(no active sessions — start one from the Tasks page)"];
  }
  const lines: string[] = [];
  for (const o of outputs) {
    lines.push(`# ${o.issueKey}  (${o.tmuxSession})`);
    lines.push(...o.output.split("\n"));
    lines.push("");
  }
  return lines;
}

export function AgentDetailView({
  role,
  detail,
  outputs,
  memoryFiles,
  live,
}: AgentDetailViewProps) {
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState<
    { kind: "ok" | "error"; text: string } | null
  >(null);

  const status = deriveAgentStatus(detail);
  const active = primaryActiveSession(detail);
  const lines = joinOutputs(outputs);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim()) return;
    setSending(true);
    setFeedback(null);
    try {
      const res = await api.agents.talk(role, message);
      setFeedback({
        kind: "ok",
        text: `Sent to ${res.sent}/${res.total} session${res.total === 1 ? "" : "s"}`,
      });
      setMessage("");
    } catch (err) {
      setFeedback({
        kind: "error",
        text:
          err instanceof ApiError
            ? `${err.status}: ${err.message}`
            : "Failed to send message",
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="p-6">
      <div className="mb-4 flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/agents" className="transition-colors hover:text-foreground">
          Agents
        </Link>
        <svg
          className="size-3"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M6 4l4 4-4 4" />
        </svg>
        <span className="text-foreground">{detail.name}</span>
        {!live && (
          <span className="ml-auto rounded-md bg-status-failed/10 px-2 py-0.5 text-xs text-status-failed">
            Mock data — backend offline
          </span>
        )}
      </div>

      {/* Agent header */}
      <div className="flex items-start gap-4">
        <div
          className={cn(
            "flex size-14 shrink-0 items-center justify-center rounded-xl text-2xl font-bold",
            avatarColors[role] ?? "bg-muted text-muted-foreground",
          )}
        >
          {agentInitial(role)}
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold tracking-tight">{detail.name}</h1>
            <StatusBadge status={status} />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {detail.activeSessions}/{detail.maxConcurrency} active,{" "}
            {detail.idleSessions} idle, {detail.suspendedSessions} suspended
          </p>
          <div className="mt-2 flex items-center gap-4 text-xs text-muted-foreground">
            <span className="font-mono">{detail.model}</span>
            <span>Duty slots: {detail.dutySlots}</span>
            {active && (
              <span>
                Working on{" "}
                <span className="font-mono text-foreground">{active.issueKey}</span>{" "}
                ({formatUptime(active.uptime)})
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Tabs: Terminal / Memory / Sessions */}
      <Tabs defaultValue="terminal" className="mt-6">
        <TabsList>
          <TabsTrigger value="terminal">Terminal</TabsTrigger>
          <TabsTrigger value="memory">
            Memory
            <span className="ml-1.5 rounded bg-secondary px-1.5 py-0.5 text-xs text-muted-foreground">
              {memoryFiles.length}
            </span>
          </TabsTrigger>
          <TabsTrigger value="sessions">
            Sessions
            <span className="ml-1.5 rounded bg-secondary px-1.5 py-0.5 text-xs text-muted-foreground">
              {detail.sessions.length}
            </span>
          </TabsTrigger>
        </TabsList>

        {/* Terminal panel */}
        <TabsContent value="terminal" className="mt-4">
          <TerminalOutput lines={lines} className="h-[400px]" />

          <form className="mt-3 flex gap-2" onSubmit={handleSend}>
            <Input
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={`Send message to ${detail.name}...`}
              className="font-mono text-sm"
              disabled={sending}
            />
            <Button type="submit" size="sm" disabled={sending || !message.trim()}>
              {sending ? "Sending..." : "Send"}
            </Button>
          </form>
          {feedback && (
            <p
              className={cn(
                "mt-2 text-xs",
                feedback.kind === "ok" ? "text-status-active" : "text-status-failed",
              )}
            >
              {feedback.text}
            </p>
          )}
        </TabsContent>

        {/* Memory panel */}
        <TabsContent value="memory" className="mt-4">
          <div className="space-y-3">
            {memoryFiles.map((filename) => (
              <div
                key={filename}
                className="flex items-center gap-3 rounded-lg border border-border bg-card p-4"
              >
                <svg
                  className="size-4 text-muted-foreground"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                >
                  <path d="M4 2h5l3 3v9H4V2z" />
                  <path d="M9 2v3h3" />
                </svg>
                <span className="font-mono text-sm font-medium">{filename}</span>
              </div>
            ))}
            {memoryFiles.length === 0 && (
              <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                No memory files yet.
              </p>
            )}
          </div>
        </TabsContent>

        {/* Sessions panel */}
        <TabsContent value="sessions" className="mt-4">
          <div className="rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Issue</th>
                  <th className="px-4 py-3 font-medium">State</th>
                  <th className="px-4 py-3 font-medium">Uptime</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {detail.sessions.map((session) => (
                  <tr
                    key={session.issueKey}
                    className="hover:bg-secondary/30"
                  >
                    <td className="px-4 py-3 font-mono text-xs">
                      {session.issueKey}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={session.state} />
                    </td>
                    <td className="px-4 py-3 font-mono text-muted-foreground">
                      {formatUptime(session.uptime)}
                    </td>
                  </tr>
                ))}
                {detail.sessions.length === 0 && (
                  <tr>
                    <td
                      colSpan={3}
                      className="px-4 py-6 text-center text-sm text-muted-foreground"
                    >
                      No sessions.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
