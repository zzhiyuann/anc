import { notFound } from "next/navigation";
import { mockAgentDetails } from "@/lib/mock-data";
import { AgentDetailView } from "./agent-detail-view";

export function generateStaticParams() {
  return Object.keys(mockAgentDetails).map((role) => ({ role }));
}

export default async function AgentDetailPage({
  params,
}: {
  params: Promise<{ role: string }>;
}) {
  const { role } = await params;
  const agent = mockAgentDetails[role];

  if (!agent) {
    notFound();
  }

  return <AgentDetailView agent={agent} />;
}
