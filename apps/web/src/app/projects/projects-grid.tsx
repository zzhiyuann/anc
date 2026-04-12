"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ProjectCard } from "@/components/project-card";
import { NewProjectDialog } from "@/components/new-project-dialog";
import { api } from "@/lib/api";
import { useWebSocket } from "@/lib/use-websocket";
import type { ProjectWithStats } from "@/lib/types";

interface Props {
  initialProjects: ProjectWithStats[];
  live: boolean;
}

export function ProjectsGrid({ initialProjects, live }: Props) {
  const [projects, setProjects] = useState(initialProjects);
  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const { lastMessage } = useWebSocket();

  // Refresh on relevant WS events.
  useEffect(() => {
    if (!lastMessage) return;
    const t = lastMessage.type;
    if (
      t === "task:created" ||
      t === "task:completed" ||
      t === "agent:spawned" ||
      t === "agent:completed"
    ) {
      void refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastMessage]);

  const refresh = async () => {
    try {
      const next = await api.projects.list();
      setProjects(next);
    } catch {
      // keep current
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return projects.filter((p) => {
      if (!showArchived && p.state === "archived") return false;
      if (showArchived && p.state !== "archived") return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        (p.description ?? "").toLowerCase().includes(q)
      );
    });
  }, [projects, search, showArchived]);

  // Refresh local copy after dialog creation completes (the dialog
  // navigates away by default, but if noNavigate=false the user lands
  // on the new project page which already loads fresh data).
  const handleCreated = () => {
    void refresh();
  };

  const activeCount = projects.filter((p) => p.state !== "archived").length;
  const archivedCount = projects.filter((p) => p.state === "archived").length;

  return (
    <div className="p-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Projects</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {activeCount} active
            {archivedCount > 0 && ` · ${archivedCount} archived`}
            {!live && " (mock data — backend offline)"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search projects…"
            className="h-9 w-56"
          />
          <Button
            variant={showArchived ? "default" : "outline"}
            size="sm"
            onClick={() => setShowArchived((s) => !s)}
          >
            {showArchived ? "Active" : "Archived"}
          </Button>
          <Button size="sm" className="gap-1.5" onClick={() => setDialogOpen(true)}>
            <svg
              className="size-3.5"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M8 3v10M3 8h10" />
            </svg>
            New Project
          </Button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          archived={showArchived}
          onCreate={() => setDialogOpen(true)}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((p) => (
            <ProjectCard key={p.id} project={p} />
          ))}
        </div>
      )}

      <NewProjectDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onCreated={handleCreated}
      />
    </div>
  );
}

function EmptyState({
  archived,
  onCreate,
}: {
  archived: boolean;
  onCreate: () => void;
}) {
  if (archived) {
    return (
      <div className="rounded-2xl border border-dashed border-border p-12 text-center">
        <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-2xl bg-secondary text-2xl">
          📦
        </div>
        <p className="text-sm font-medium">No archived projects</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Archived projects show up here when you retire them.
        </p>
      </div>
    );
  }
  return (
    <div className="rounded-2xl border border-dashed border-border p-12 text-center">
      <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500/30 to-sky-500/30 text-2xl">
        🚀
      </div>
      <p className="text-sm font-medium">Create your first project</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Group related tasks, track cost, and steer your agents toward a goal.
      </p>
      <Button size="sm" className="mt-4" onClick={onCreate}>
        New Project
      </Button>
    </div>
  );
}

