import { KpiCard } from "@/components/kpi-card";
import { AgentCard } from "@/components/agent-card";
import { ActivityItem } from "@/components/activity-item";
import { ScrollArea } from "@/components/ui/scroll-area";
import { api } from "@/lib/api";
import {
  mockAgents,
  mockEvents,
  mockQueueItems,
  deriveKpis,
} from "@/lib/mock-data";
import { parseEventTimestamp } from "@/lib/utils";
import type { AgentStatus, EventRow, QueueItem } from "@/lib/types";

// Always fetch at request time — never prerender dashboard data.
export const dynamic = "force-dynamic";

async function loadData(): Promise<{
  agents: AgentStatus[];
  events: EventRow[];
  queueItems: QueueItem[];
  live: boolean;
}> {
  try {
    const [agents, events, queueItems] = await Promise.all([
      api.agents.list(),
      api.events.list(50),
      api.queue.list("queued"),
    ]);
    return { agents, events, queueItems, live: true };
  } catch {
    // Backend unreachable → fall back to realistic mock shapes.
    return {
      agents: mockAgents,
      events: mockEvents,
      queueItems: mockQueueItems,
      live: false,
    };
  }
}

export default async function CommandCenter() {
  const { agents, events, queueItems, live } = await loadData();
  const kpis = deriveKpis(agents, queueItems);

  const sortedEvents = [...events].sort(
    (a, b) =>
      parseEventTimestamp(b.createdAt) - parseEventTimestamp(a.createdAt),
  );

  return (
    <div className="p-6">
      {/* Page header */}
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Command Center</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {live
              ? "Real-time overview of your AI company"
              : "Backend offline — showing mock data"}
          </p>
        </div>
        {!live && (
          <span className="rounded-md bg-status-failed/10 px-2 py-1 text-xs text-status-failed">
            Disconnected
          </span>
        )}
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Running Agents"
          value={kpis.running}
          detail={`${kpis.running} active across ${kpis.agentCount} roles`}
          icon={
            <svg
              className="size-4"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <circle cx="8" cy="5" r="3" />
              <path d="M3 14c0-2.8 2.2-5 5-5s5 2.2 5 5" />
            </svg>
          }
        />
        <KpiCard
          label="Idle Sessions"
          value={kpis.idle}
          detail="Resumable via --continue"
          icon={
            <svg
              className="size-4"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <path d="M5 6h2v6H5zM9 6h2v6H9z" />
            </svg>
          }
        />
        <KpiCard
          label="Queued Tasks"
          value={kpis.queued}
          detail="Waiting for agent capacity"
          icon={
            <svg
              className="size-4"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <path d="M3 4h10M3 8h10M3 12h10" />
            </svg>
          }
        />
        <KpiCard
          label="Events (24h)"
          value={events.length}
          detail="Recent bus events"
          icon={
            <svg
              className="size-4"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <path d="M3 8h3l2-4 2 8 2-4h2" />
            </svg>
          }
        />
      </div>

      {/* Main content: Agents + Activity */}
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-5">
        {/* Agent Status */}
        <div className="lg:col-span-3">
          <div className="rounded-xl border border-border bg-card">
            <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
              <h2 className="text-sm font-semibold">Agent Status</h2>
              <span className="text-xs text-muted-foreground">
                {agents.length} agents
              </span>
            </div>
            <div className="divide-y divide-border">
              {agents.map((agent) => (
                <AgentCard key={agent.role} agent={agent} compact />
              ))}
              {agents.length === 0 && (
                <p className="p-5 text-sm text-muted-foreground">
                  No agents registered.
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Activity Feed */}
        <div className="lg:col-span-2">
          <div className="rounded-xl border border-border bg-card">
            <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
              <h2 className="text-sm font-semibold">Activity</h2>
              <span className="text-xs text-muted-foreground">
                {sortedEvents.length} events
              </span>
            </div>
            <ScrollArea className="h-[360px]">
              <div className="divide-y divide-border/50 px-4 py-1">
                {sortedEvents.map((event) => (
                  <ActivityItem key={event.id} event={event} />
                ))}
                {sortedEvents.length === 0 && (
                  <p className="p-4 text-sm text-muted-foreground">
                    No recent events.
                  </p>
                )}
              </div>
            </ScrollArea>
          </div>
        </div>
      </div>
    </div>
  );
}
