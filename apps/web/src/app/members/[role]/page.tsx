import { notFound } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import {
  mockAgentDetails,
  mockAgentMemory,
  mockAgentOutputs,
} from "@/lib/mock-data";
import { AgentDetailView } from "@/app/agents/[role]/agent-detail-view";
import type { AgentOutput, AgentStatusDetail } from "@/lib/types";

export const dynamic = "force-dynamic";

async function loadAgent(role: string): Promise<{
  detail: AgentStatusDetail;
  outputs: AgentOutput[];
  memoryFiles: string[];
  live: boolean;
} | null> {
  try {
    const [detail, outputs, memory] = await Promise.all([
      api.agents.get(role),
      api.agents.output(role, 200).catch(() => [] as AgentOutput[]),
      api.agents.memory(role).catch(() => ({ files: [] as string[] })),
    ]);
    return {
      detail,
      outputs,
      memoryFiles: memory.files,
      live: true,
    };
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;

    const detail = mockAgentDetails[role];
    if (!detail) return null;
    return {
      detail,
      outputs: mockAgentOutputs[role] ?? [],
      memoryFiles: mockAgentMemory[role] ?? [],
      live: false,
    };
  }
}

export default async function MemberDetailPage({
  params,
}: {
  params: Promise<{ role: string }>;
}) {
  const { role } = await params;
  const data = await loadAgent(role);

  if (!data) {
    notFound();
  }

  return (
    <AgentDetailView
      role={role}
      detail={data.detail}
      outputs={data.outputs}
      memoryFiles={data.memoryFiles}
      live={data.live}
    />
  );
}
