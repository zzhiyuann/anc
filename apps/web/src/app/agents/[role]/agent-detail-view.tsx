"use client";

/**
 * AgentDetailView — full per-agent workspace page (Linear-parity).
 *
 * Layout:
 *   header  : avatar + name + handle + status pill + "Dispatch a task"
 *   stats   : N active · M idle · K done 7d · $X today · capacity %
 *   tabs    : Persona · Terminal · Memory · Sessions · Cost · Activity
 *
 * Real-time: re-fetches detail + outputs whenever the WS pushes any
 * agent:* event for this role.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import { TerminalOutput } from "@/components/terminal-output";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PersonaTab } from "@/components/agents/persona-tab";
import { SessionsTab } from "@/components/agents/sessions-tab";
import { CostTab } from "@/components/agents/cost-tab";
import { ActivityTab } from "@/components/agents/activity-tab";
import { MemoryTab } from "@/components/agents/memory-tab";
import { DispatchTaskDialog } from "@/components/members/dispatch-task-dialog";
import { colorForRole } from "@/components/members/members-table";
import { api, ApiError } from "@/lib/api";
import { useWebSocket } from "@/lib/use-websocket";
import {
  agentInitial,
  cn,
  deriveAgentStatus,
  formatUptime,
} from "@/lib/utils";
import type {
  AgentOutput,
  AgentStatusDetail,
  EventRow,
} from "@/lib/types";

const ONE_WEEK_MS = 7 * 24 * 3600 * 1000;

interface AgentDetailViewProps {
  role: string;
  detail: AgentStatusDetail;
  outputs: AgentOutput[];
  memoryFiles: string[];
  live: boolean;
}

function joinOutputs(outputs: AgentOutput[]): string[] {
  if (outputs.length === 0) return ["No active terminal."];
  const lines: string[] = [];
  for (const o of outputs) {
    lines.push(`# ${o.issueKey}  (${o.tmuxSession})`);
    lines.push(...o.output.split("\n"));
    lines.push("");
  }
  return lines;
}

function statusLabel(state: ReturnType<typeof deriveAgentStatus>): string {
  switch (state) {
    case "active":
      return "Online";
    case "suspended":
      return "Suspended";
    case "idle":
      return "Idle";
    default:
      return "Idle";
  }
}

export function AgentDetailView({
  role,
  detail: initialDetail,
  outputs: initialOutputs,
  memoryFiles,
  live,
}: AgentDetailViewProps) {
  const [detail, setDetail] = useState<AgentStatusDetail>(initialDetail);
  const [outputs, setOutputs] = useState<AgentOutput[]>(initialOutputs);
  const [doneThisWeek, setDoneThisWeek] = useState<number>(0);
  const [costToday, setCostToday] = useState<number>(0);
  const [showDispatch, setShowDispatch] = useState(false);

  // Terminal send-message form state.
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState<
    { kind: "ok" | "error"; text: string } | null
  >(null);

  // WS: re-fetch detail + outputs when any agent event lands. Keeps Terminal
  // and Stats live without polling.
  const { lastMessage } = useWebSocket();
  const refresh = useCallback(async () => {
    try {
      const [d, out] = await Promise.all([
        api.agents.get(role),
        api.agents.output(role, 200).catch(() => [] as AgentOutput[]),
      ]);
      setDetail(d);
      setOutputs(out);
    } catch {
      // Keep last good state on transient errors.
    }
  }, [role]);
  useEffect(() => {
    if (!lastMessage) return;
    if (
      lastMessage.type.startsWith("agent:") ||
      lastMessage.type === "snapshot"
    ) {
      void refresh();
    }
  }, [lastMessage, refresh]);

  // Periodic refresh of the terminal panel so the captured tmux output stays
  // current even when no WS events fire (e.g. agent is mid-stream).
  useEffect(() => {
    const id = setInterval(() => {
      void api.agents
        .output(role, 200)
        .then(setOutputs)
        .catch(() => {});
    }, 5000);
    return () => clearInterval(id);
  }, [role]);

  // Derive "done this week" + "cost today" from real endpoints.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const events = await api.events.list(500);
        if (cancelled) return;
        const cutoff = Date.now() - ONE_WEEK_MS;
        const count = events.filter((e: EventRow) => {
          if (e.eventType !== "agent:completed") return false;
          if (e.role !== role) return false;
          const tsMs = new Date(e.createdAt.replace(" ", "T") + "Z").getTime();
          return tsMs >= cutoff;
        }).length;
        setDoneThisWeek(count);
      } catch {
        /* ignore */
      }
      try {
        const cfg = await api.config.getBudget();
        if (cancelled) return;
        setCostToday(cfg.summary.perAgent?.[role]?.spent ?? 0);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [role]);

  const status = deriveAgentStatus(detail);
  const lines = joinOutputs(outputs);
  const capacityPct =
    detail.maxConcurrency > 0
      ? Math.round(
          ((detail.activeSessions + detail.idleSessions) /
            detail.maxConcurrency) *
            100,
        )
      : 0;

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
      {/* Breadcrumb */}
      <div className="mb-4 flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/members" className="transition-colors hover:text-foreground">
          Members
        </Link>
        <ChevronRight className="size-3.5" />
        <span className="text-foreground">{detail.name}</span>
        {!live && (
          <span className="ml-auto rounded-md bg-status-failed/10 px-2 py-0.5 text-xs text-status-failed">
            Mock data — backend offline
          </span>
        )}
      </div>

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <div
            className={cn(
              "flex size-14 shrink-0 items-center justify-center rounded-xl text-2xl font-bold",
              colorForRole(role),
            )}
          >
            {agentInitial(role)}
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-semibold tracking-tight">
                {detail.name}
              </h1>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary/60 px-2 py-0.5 text-[11px]">
                <span
                  className={cn(
                    "size-1.5 rounded-full",
                    status === "active" ? "bg-status-active" : "bg-status-idle",
                  )}
                />
                {statusLabel(status)}
              </span>
            </div>
            <p className="mt-0.5 font-mono text-[12px] text-muted-foreground">
              @{role}
            </p>
            <div className="mt-2 flex items-center gap-4 text-xs text-muted-foreground">
              <span className="font-mono">{detail.model}</span>
              <span>Duty slots: {detail.dutySlots}</span>
            </div>
          </div>
        </div>
        <Button onClick={() => setShowDispatch(true)} className="gap-1.5">
          Dispatch a task
        </Button>
      </div>

      {/* Stats bar */}
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat label="Active" value={detail.activeSessions} />
        <Stat label="Idle" value={detail.idleSessions} />
        <Stat label="Done 7d" value={doneThisWeek} />
        <Stat label="Cost today" value={`$${costToday.toFixed(2)}`} />
        <Stat label="Capacity" value={`${capacityPct}%`} />
      </div>

      {/* Tabs */}
      <Tabs defaultValue="persona" className="mt-6">
        <TabsList>
          <TabsTrigger value="persona">Persona</TabsTrigger>
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
          <TabsTrigger value="cost">Cost</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>

        <TabsContent value="persona" className="mt-4">
          <PersonaTab role={role} />
        </TabsContent>

        <TabsContent value="terminal" className="mt-4">
          {outputs.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
              No active terminal.
            </div>
          ) : (
            <TerminalOutput lines={lines} className="h-[420px]" />
          )}

          <form className="mt-3 flex gap-2" onSubmit={handleSend}>
            <Input
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={`Send message to ${detail.name}...`}
              className="font-mono text-sm"
              disabled={sending || outputs.length === 0}
            />
            <Button
              type="submit"
              size="sm"
              disabled={sending || !message.trim() || outputs.length === 0}
            >
              {sending ? "Sending..." : "Send"}
            </Button>
          </form>
          {feedback && (
            <p
              className={cn(
                "mt-2 text-xs",
                feedback.kind === "ok"
                  ? "text-status-active"
                  : "text-status-failed",
              )}
            >
              {feedback.text}
            </p>
          )}
        </TabsContent>

        <TabsContent value="memory" className="mt-4">
          <MemoryTab role={role} initialFiles={memoryFiles} />
        </TabsContent>

        <TabsContent value="sessions" className="mt-4">
          <SessionsTab detail={detail} />
        </TabsContent>

        <TabsContent value="cost" className="mt-4">
          <CostTab role={role} />
        </TabsContent>

        <TabsContent value="activity" className="mt-4">
          <ActivityTab role={role} />
        </TabsContent>
      </Tabs>

      <DispatchTaskDialog
        open={showDispatch}
        onOpenChange={setShowDispatch}
        role={role}
        roleName={detail.name}
        onDispatched={() => void refresh()}
      />
    </div>
  );
}

// keep formatUptime imported for future use in sessions sub-tab via re-export
void formatUptime;

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-0.5 font-mono text-base text-foreground">{value}</div>
    </div>
  );
}
