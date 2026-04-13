import { api } from "@/lib/api";
import { mockAgents } from "@/lib/mock-data";
import type { AgentStatus } from "@/lib/types";
import { MembersView } from "@/components/members/members-view";

export const dynamic = "force-dynamic";

async function loadAgents(): Promise<{ agents: AgentStatus[]; live: boolean }> {
  try {
    const agents = await api.agents.list();
    return { agents, live: true };
  } catch {
    return { agents: mockAgents, live: false };
  }
}

export default async function MembersPage() {
  const { agents, live } = await loadAgents();
  return <MembersView initialAgents={agents} initialLive={live} />;
}
