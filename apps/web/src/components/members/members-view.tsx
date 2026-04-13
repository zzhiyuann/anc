"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, Search } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { AgentStatus } from "@/lib/types";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { MembersTable, type MemberRow } from "./members-table";
import { NewRoleDialog } from "@/components/settings/new-role-dialog";
import { PersonaEditor } from "@/components/settings/persona-editor";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface MembersViewProps {
  initialAgents: AgentStatus[];
  initialLive: boolean;
}

const HARDCODED_JOIN_MS = new Date("2026-03-01T00:00:00Z").getTime();

function buildRows(agents: AgentStatus[]): MemberRow[] {
  return agents.map((agent) => {
    const active = agent.sessions.find((s) => s.state === "active");
    const lastSeenMs = active?.uptime != null ? Date.now() - active.uptime * 1000 : null;
    return {
      agent,
      joinedMs: HARDCODED_JOIN_MS,
      memoryCount: 0,
      lastSeenMs,
    };
  });
}

export function MembersView({ initialAgents, initialLive }: MembersViewProps) {
  const [agents, setAgents] = useState<AgentStatus[]>(initialAgents);
  const [live, setLive] = useState(initialLive);
  const [query, setQuery] = useState("");
  const [showNewRole, setShowNewRole] = useState(false);
  const [editingRole, setEditingRole] = useState<string | null>(null);
  const [memoryCounts, setMemoryCounts] = useState<Record<string, number>>({});

  // Hydrate memory counts client-side. Each call is best-effort.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        agents.map(async (a) => {
          try {
            const m = await api.agents.memory(a.role);
            return [a.role, m.files.length] as const;
          } catch {
            return [a.role, 0] as const;
          }
        }),
      );
      if (!cancelled) {
        setMemoryCounts(Object.fromEntries(entries));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [agents]);

  async function refresh() {
    try {
      const list = await api.agents.list();
      setAgents(list);
      setLive(true);
    } catch {
      setLive(false);
    }
  }

  async function handleArchive(role: string) {
    if (!confirm(`Archive ${role}? This removes it from config/agents.yaml.`)) return;
    try {
      await api.agents.archiveRole(role);
    } catch (err) {
      if (!(err instanceof ApiError) || (err.status !== 404 && err.status !== 0)) {
        alert(`Failed to archive: ${(err as Error).message}`);
        return;
      }
    }
    setAgents((prev) => prev.filter((a) => a.role !== role));
  }

  const rows = useMemo(() => {
    const baseRows = buildRows(agents).map((r) => ({
      ...r,
      memoryCount: memoryCounts[r.agent.role] ?? 0,
    }));
    const q = query.trim().toLowerCase();
    if (!q) return baseRows;
    return baseRows.filter(
      (r) =>
        r.agent.name.toLowerCase().includes(q) ||
        r.agent.role.toLowerCase().includes(q),
    );
  }, [agents, memoryCounts, query]);

  return (
    <div className="p-6">
      <div className="mb-5 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold tracking-tight">Members</h1>
          <span className="rounded-full bg-secondary/60 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            {agents.length}
          </span>
          {!live && (
            <span className="text-[11px] text-muted-foreground">
              (mock data — backend offline)
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search members"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-8 w-56 pl-8 text-[13px]"
            />
          </div>
          <Button
            size="sm"
            onClick={() => setShowNewRole(true)}
            className="h-8 gap-1"
          >
            <Plus className="size-4" />
            New role
          </Button>
        </div>
      </div>

      <MembersTable
        rows={rows}
        onEditPersona={(role) => setEditingRole(role)}
        onArchive={handleArchive}
      />

      <NewRoleDialog
        open={showNewRole}
        onOpenChange={setShowNewRole}
        onCreated={refresh}
      />

      <Dialog
        open={editingRole != null}
        onOpenChange={(o) => !o && setEditingRole(null)}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit persona — {editingRole}</DialogTitle>
          </DialogHeader>
          {editingRole && <PersonaEditor role={editingRole} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
