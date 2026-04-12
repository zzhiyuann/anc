import { AgentCard } from "@/components/agent-card";
import { api } from "@/lib/api";
import { mockAgents } from "@/lib/mock-data";
import type { AgentStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

async function loadAgents(): Promise<{ agents: AgentStatus[]; live: boolean }> {
  try {
    const agents = await api.agents.list();
    return { agents, live: true };
  } catch {
    return { agents: mockAgents, live: false };
  }
}

export default async function AgentsPage() {
  const { agents, live } = await loadAgents();

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">Agents</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {agents.length} agents in your company
          {!live && " (mock data — backend offline)"}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {agents.map((agent) => (
          <AgentCard key={agent.role} agent={agent} />
        ))}
        {agents.length === 0 && (
          <p className="col-span-full rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            No agents registered.
          </p>
        )}
      </div>
    </div>
  );
}
