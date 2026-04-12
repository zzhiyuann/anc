import { notFound } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import {
  mockAgentDetails,
  mockAgentMemory,
  mockAgentOutputs,
} from "@/lib/mock-data";
import { AgentDetailView } from "./agent-detail-view";
import type { AgentOutput, AgentStatusDetail } from "@/lib/types";

// No generateStaticParams — routes are dynamic and fetched at request time.
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

    // Backend offline — fall back to mocks if the role exists in the mock set.
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

export default async function AgentDetailPage({
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
