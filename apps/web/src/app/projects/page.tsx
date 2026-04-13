import { api } from "@/lib/api";
import { mockProjectsWithStats } from "@/lib/mock-data";
import type { ProjectWithStats } from "@/lib/types";
import { ProjectsTable } from "@/components/projects/projects-table";

export const dynamic = "force-dynamic";

async function loadProjects(): Promise<{
  projects: ProjectWithStats[];
  live: boolean;
}> {
  try {
    const projects = await api.projects.list();
    return { projects, live: true };
  } catch {
    return { projects: mockProjectsWithStats, live: false };
  }
}

export default async function ProjectsPage() {
  const { projects, live } = await loadProjects();
  return <ProjectsTable initialProjects={projects} live={live} />;
}
