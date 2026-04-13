import { Separator } from "@/components/ui/separator";
import { AgentsSection } from "@/components/settings/agents-section";
import { BudgetSection } from "./budget-section";
import { api } from "@/lib/api";
import { mockAgents } from "@/lib/mock-data";
import { formatUptime } from "@/lib/utils";
import type { AgentStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

async function loadSettings(): Promise<{
  agents: AgentStatus[];
  live: boolean;
}> {
  try {
    const agents = await api.agents.list();
    return { agents, live: true };
  } catch {
    return { agents: mockAgents, live: false };
  }
}

export default async function SettingsPage() {
  const { agents, live } = await loadSettings();
  const totalActive = agents.reduce((sum, a) => sum + a.activeSessions, 0);
  const totalIdle = agents.reduce((sum, a) => sum + a.idleSessions, 0);
  const totalSuspended = agents.reduce((sum, a) => sum + a.suspendedSessions, 0);

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          System configuration and status
        </p>
      </div>

      <div className="max-w-2xl space-y-6">
        {/* Backend status */}
        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold">Backend</h2>
          <Separator className="my-3" />
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">Status</span>
              <p
                className={`mt-0.5 font-medium ${
                  live ? "text-status-active" : "text-status-failed"
                }`}
              >
                {live ? "Connected" : "Offline"}
              </p>
            </div>
            <div>
              <span className="text-muted-foreground">Registered Agents</span>
              <p className="mt-0.5 font-mono font-medium">{agents.length}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Active Sessions</span>
              <p className="mt-0.5 font-mono font-medium">{totalActive}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Idle / Suspended</span>
              <p className="mt-0.5 font-mono font-medium">
                {totalIdle} / {totalSuspended}
              </p>
            </div>
          </div>
        </div>

        {/* Connection */}
        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold">Connection</h2>
          <Separator className="my-3" />
          <div className="space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">API Endpoint</span>
              <span className="font-mono">
                {process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3849"}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">WebSocket</span>
              <span className="font-mono">
                {process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:3849/ws"}
              </span>
            </div>
          </div>
        </div>

        <AgentsSection />

        <BudgetSection />

        {/* Agent capacity */}
        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold">Agent Capacity</h2>
          <Separator className="my-3" />
          <div className="space-y-3 text-sm">
            {agents.map((a) => (
              <div key={a.role} className="flex items-center justify-between">
                <span className="text-muted-foreground">{a.name}</span>
                <span className="font-mono">
                  {a.activeSessions}/{a.maxConcurrency} active ·{" "}
                  {formatUptime(
                    a.sessions.find((s) => s.state === "active")?.uptime ?? 0,
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
