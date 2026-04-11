import { KpiCard } from "@/components/kpi-card";
import { AgentCard } from "@/components/agent-card";
import { ActivityItem } from "@/components/activity-item";
import { ScrollArea } from "@/components/ui/scroll-area";
import { getKpis, mockAgents, mockEvents } from "@/lib/mock-data";

export default function CommandCenter() {
  const kpis = getKpis();
  const sortedEvents = [...mockEvents].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  return (
    <div className="p-6">
      {/* Page header */}
      <div className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">Command Center</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Real-time overview of your AI company
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Running Agents"
          value={kpis.running}
          detail={`${kpis.running} of ${mockAgents.length} agents active`}
          trend="up"
          trendValue="1 since yesterday"
          icon={
            <svg className="size-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="8" cy="5" r="3" />
              <path d="M3 14c0-2.8 2.2-5 5-5s5 2.2 5 5" />
            </svg>
          }
        />
        <KpiCard
          label="Idle Agents"
          value={kpis.idle}
          detail="Ready for assignment"
          trend="neutral"
          trendValue="stable"
          icon={
            <svg className="size-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M5 6h2v6H5zM9 6h2v6H9z" />
            </svg>
          }
        />
        <KpiCard
          label="Queued Tasks"
          value={kpis.queued}
          detail="Waiting for agent capacity"
          trend="down"
          trendValue="2 from peak"
          icon={
            <svg className="size-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M3 4h10M3 8h10M3 12h10" />
            </svg>
          }
        />
        <KpiCard
          label="Today's Cost"
          value={`$${kpis.todayCost.toFixed(2)}`}
          detail="API token usage"
          trend="up"
          trendValue="$1.20 vs avg"
          icon={
            <svg className="size-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M8 2v12M5 5c0-1 1-2 3-2s3 1 3 2-1 2-3 2-3 1-3 2 1 2 3 2 3-1 3-2" />
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
                {mockAgents.length} agents
              </span>
            </div>
            <div className="divide-y divide-border">
              {mockAgents.map((agent) => (
                <AgentCard key={agent.role} agent={agent} compact />
              ))}
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
              </div>
            </ScrollArea>
          </div>
        </div>
      </div>
    </div>
  );
}
