import { AgentCard } from "@/components/agent-card";
import { mockAgents } from "@/lib/mock-data";

export default function AgentsPage() {
  return (
    <div className="p-6">
      {/* Page header */}
      <div className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">Agents</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {mockAgents.length} agents in your company
        </p>
      </div>

      {/* Agent grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {mockAgents.map((agent) => (
          <AgentCard key={agent.role} agent={agent} />
        ))}
      </div>
    </div>
  );
}
