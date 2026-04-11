"use client";

import { useState } from "react";
import Link from "next/link";
import { StatusBadge } from "@/components/status-badge";
import { TerminalOutput } from "@/components/terminal-output";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import type { AgentDetail } from "@/lib/types";

const avatarColors: Record<string, string> = {
  engineer: "bg-blue-500/20 text-blue-400",
  strategist: "bg-purple-500/20 text-purple-400",
  ops: "bg-amber-500/20 text-amber-400",
};

function formatUptime(seconds: number): string {
  if (seconds === 0) return "Offline";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function formatTimestamp(ts: string): string {
  return new Date(ts).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

interface AgentDetailViewProps {
  agent: AgentDetail;
}

export function AgentDetailView({ agent }: AgentDetailViewProps) {
  const [message, setMessage] = useState("");

  return (
    <div className="p-6">
      {/* Breadcrumb */}
      <div className="mb-4 flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/agents" className="transition-colors hover:text-foreground">
          Agents
        </Link>
        <svg className="size-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M6 4l4 4-4 4" />
        </svg>
        <span className="text-foreground">{agent.name}</span>
      </div>

      {/* Agent header */}
      <div className="flex items-start gap-4">
        <div
          className={cn(
            "flex size-14 shrink-0 items-center justify-center rounded-xl text-2xl font-bold",
            avatarColors[agent.role] ?? "bg-muted text-muted-foreground"
          )}
        >
          {agent.avatar}
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold tracking-tight">{agent.name}</h1>
            <StatusBadge status={agent.status} />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{agent.description}</p>
          <div className="mt-2 flex items-center gap-4 text-xs text-muted-foreground">
            <span className="font-mono">{agent.model}</span>
            <span>Uptime: {formatUptime(agent.uptime)}</span>
            {agent.currentIssueKey && (
              <span>
                Working on{" "}
                <span className="font-mono text-foreground">
                  {agent.currentIssueKey}
                </span>
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
              {agent.memoryEntries.length}
            </span>
          </TabsTrigger>
          <TabsTrigger value="sessions">
            Sessions
            <span className="ml-1.5 rounded bg-secondary px-1.5 py-0.5 text-xs text-muted-foreground">
              {agent.sessions.length}
            </span>
          </TabsTrigger>
        </TabsList>

        {/* Terminal panel */}
        <TabsContent value="terminal" className="mt-4">
          <TerminalOutput lines={agent.outputLines} className="h-[400px]" />

          {/* Talk input */}
          <form
            className="mt-3 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setMessage("");
            }}
          >
            <Input
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={`Send message to ${agent.name}...`}
              className="font-mono text-sm"
            />
            <Button type="submit" size="sm" disabled={!message.trim()}>
              Send
            </Button>
          </form>
        </TabsContent>

        {/* Memory panel */}
        <TabsContent value="memory" className="mt-4">
          <div className="space-y-3">
            {agent.memoryEntries.map((entry) => (
              <div
                key={entry.filename}
                className="rounded-lg border border-border bg-card p-4"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <svg className="size-4 text-muted-foreground" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="M4 2h5l3 3v9H4V2z" />
                      <path d="M9 2v3h3" />
                    </svg>
                    <span className="font-mono text-sm font-medium">
                      {entry.filename}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span>{formatBytes(entry.sizeBytes)}</span>
                    <span>{formatTimestamp(entry.updatedAt)}</span>
                  </div>
                </div>
                <ScrollArea className="mt-3 max-h-32">
                  <pre className="font-mono text-xs leading-relaxed text-muted-foreground">
                    {entry.content}
                  </pre>
                </ScrollArea>
              </div>
            ))}
          </div>
        </TabsContent>

        {/* Sessions panel */}
        <TabsContent value="sessions" className="mt-4">
          <div className="rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Issue</th>
                  <th className="px-4 py-3 font-medium">Started</th>
                  <th className="px-4 py-3 font-medium">Duration</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {agent.sessions.map((session) => (
                  <tr key={session.id} className="hover:bg-secondary/30">
                    <td className="px-4 py-3 font-mono text-xs">
                      {session.issueKey}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {formatTimestamp(session.startedAt)}
                    </td>
                    <td className="px-4 py-3 font-mono text-muted-foreground">
                      {formatDuration(session.duration)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium",
                          session.status === "running" &&
                            "bg-status-active/10 text-status-active",
                          session.status === "completed" &&
                            "bg-status-completed/10 text-status-completed",
                          session.status === "failed" &&
                            "bg-status-failed/10 text-status-failed",
                          session.status === "killed" &&
                            "bg-status-idle/10 text-status-idle"
                        )}
                      >
                        {session.status === "running" && (
                          <span className="size-1.5 animate-pulse rounded-full bg-status-active" />
                        )}
                        {session.status.charAt(0).toUpperCase() +
                          session.status.slice(1)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
