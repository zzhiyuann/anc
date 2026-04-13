"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, Search } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { AgentStatus } from "@/lib/types";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { MembersTable, type MemberRow } from "./members-table";
import { DispatchTaskDialog } from "./dispatch-task-dialog";
import { NewRoleDialog } from "@/components/settings/new-role-dialog";
import { PersonaEditor } from "@/components/settings/persona-editor";
import { useWebSocket } from "@/lib/use-websocket";
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
const ONE_WEEK_MS = 7 * 24 * 3600 * 1000;

export function MembersView({ initialAgents, initialLive }: MembersViewProps) {
  const [agents, setAgents] = useState<AgentStatus[]>(initialAgents);
  const [live, setLive] = useState(initialLive);
  const [query, setQuery] = useState("");
  const [showNewRole, setShowNewRole] = useState(false);
  const [editingRole, setEditingRole] = useState<string | null>(null);
  const [dispatchRole, setDispatchRole] = useState<string | null>(null);
  const [memoryCounts, setMemoryCounts] = useState<Record<string, number>>({});
  const [costToday, setCostToday] = useState<Record<string, number>>({});
  const [doneByRole, setDoneByRole] = useState<Record<string, number>>({});
  const [taskTitles, setTaskTitles] = useState<Map<string, string>>(new Map());

  // Subscribe to WS so member status / active sessions stay live.
  const { lastMessage } = useWebSocket();
  useEffect(() => {
    if (!lastMessage) return;
    if (
      lastMessage.type.startsWith("agent:") ||
      lastMessage.type === "snapshot"
    ) {
      void refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastMessage]);

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
      if (!cancelled) setMemoryCounts(Object.fromEntries(entries));
    })();
    return () => {
      cancelled = true;
    };
  }, [agents]);

  // Hydrate "Cost today" from /config/budget summary.perAgent.spent.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cfg = await api.config.getBudget();
        if (cancelled) return;
        const out: Record<string, number> = {};
        for (const [role, v] of Object.entries(cfg.summary.perAgent ?? {})) {
          out[role] = v.spent ?? 0;
        }
        setCostToday(out);
      } catch {
        // Backend offline or budget endpoint not wired — leave costs at 0.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [agents]);

  // Hydrate "done this week" using the recent events stream filtered to
  // agent:completed events per role. Backend gap: /events does not accept a
  // role filter, and the first-class Task entity does not yet store an
  // `assignee` column — so we count completion events client-side, which is
  // the most reliable per-role attribution available today.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const evs = await api.events.list(500);
        const cutoff = Date.now() - ONE_WEEK_MS;
        const counts: Record<string, number> = {};
        for (const e of evs) {
          if (e.eventType !== "agent:completed") continue;
          if (!e.role) continue;
          const tsMs = new Date(e.createdAt.replace(" ", "T") + "Z").getTime();
          if (tsMs < cutoff) continue;
          counts[e.role] = (counts[e.role] ?? 0) + 1;
        }
        if (!cancelled) setDoneByRole(counts);
      } catch {
        // Backend offline — leave counts at 0.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [agents]);

  // Hydrate task titles so the Active Task column shows human-readable names.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const tasks = await api.tasks.list({});
        if (cancelled) return;
        const m = new Map<string, string>();
        for (const t of tasks) m.set(t.id, t.title);
        setTaskTitles(m);
      } catch {
        // leave empty
      }
    })();
    return () => { cancelled = true; };
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
    if (!confirm(`Archive ${role}? This removes it from config/agents.yaml.`))
      return;
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

  const rows: MemberRow[] = useMemo(() => {
    const baseRows = agents.map((agent): MemberRow => {
      const active = agent.sessions.find((s) => s.state === "active");
      const lastSeenMs =
        active?.uptime != null ? Date.now() - active.uptime * 1000 : null;
      return {
        agent,
        joinedMs: HARDCODED_JOIN_MS,
        memoryCount: memoryCounts[agent.role] ?? 0,
        lastSeenMs,
        activeTaskId: active?.issueKey ?? null,
        costTodayUsd: costToday[agent.role] ?? 0,
        doneThisWeek: doneByRole[agent.role] ?? 0,
      };
    });
    const q = query.trim().toLowerCase();
    if (!q) return baseRows;
    return baseRows.filter(
      (r) =>
        r.agent.name.toLowerCase().includes(q) ||
        r.agent.role.toLowerCase().includes(q),
    );
  }, [agents, memoryCounts, costToday, doneByRole, query]);

  const dispatchAgent = dispatchRole
    ? agents.find((a) => a.role === dispatchRole)
    : null;

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
            New member
          </Button>
        </div>
      </div>

      {agents.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-12 text-center">
          <p className="text-sm text-muted-foreground">
            No members yet. Create your first agent to get started.
          </p>
          <Button
            size="sm"
            onClick={() => setShowNewRole(true)}
            className="mt-4 gap-1"
          >
            <Plus className="size-4" />
            New member
          </Button>
        </div>
      ) : (
        <MembersTable
          rows={rows}
          taskTitles={taskTitles}
          onEditPersona={(role) => setEditingRole(role)}
          onArchive={handleArchive}
          onDispatch={(role) => setDispatchRole(role)}
        />
      )}

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

      {dispatchAgent && (
        <DispatchTaskDialog
          open={dispatchRole != null}
          onOpenChange={(o) => !o && setDispatchRole(null)}
          role={dispatchAgent.role}
          roleName={dispatchAgent.name}
          onDispatched={() => void refresh()}
        />
      )}
    </div>
  );
}
