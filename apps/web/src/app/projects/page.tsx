import { api } from "@/lib/api";
import { mockProjectsWithStats } from "@/lib/mock-data";
import type { ProjectWithStats } from "@/lib/types";
import { ProjectsGrid } from "./projects-grid";

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
  return <ProjectsGrid initialProjects={projects} live={live} />;
}
