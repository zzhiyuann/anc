import { notFound } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { mockProject, mockTask } from "@/lib/mock-data";
import type { Project, ProjectStats, Task } from "@/lib/types";
import { ProjectDetailView } from "./project-detail-view";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

async function loadProject(id: string): Promise<{
  project: Project;
  recentTasks: Task[];
  stats: ProjectStats;
  live: boolean;
} | null> {
  try {
    const data = await api.projects.get(id);
    return { ...data, live: true };
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      return null;
    }
    return {
      project: { ...mockProject, id },
      recentTasks: [mockTask],
      stats: { total: 1, running: 1, queued: 0, done: 0, totalCostUsd: 0 },
      live: false,
    };
  }
}

export default async function ProjectDetailPage({ params }: PageProps) {
  const { id } = await params;
  const data = await loadProject(id);
  if (!data) notFound();
  return (
    <ProjectDetailView
      project={data.project}
      recentTasks={data.recentTasks}
      stats={data.stats}
      live={data.live}
    />
  );
}
