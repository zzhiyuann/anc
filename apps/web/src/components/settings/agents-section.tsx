"use client";

import { useEffect, useState } from "react";
import { Plus, MoreHorizontal } from "lucide-react";
import { api, ApiError, type PersonaSuggestion } from "@/lib/api";
import type { AgentStatus } from "@/lib/types";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { NewRoleDialog } from "./new-role-dialog";
import { PersonaEditor } from "./persona-editor";

export function AgentsSection() {
  const [agents, setAgents] = useState<AgentStatus[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<PersonaSuggestion[]>([]);
  const [analyzeLive, setAnalyzeLive] = useState(false);

  async function refresh() {
    try {
      const list = await api.agents.list();
      setAgents(list);
    } catch {
      setAgents([]);
    } finally {
      setLoaded(true);
    }
  }

  useEffect(() => {
    void refresh();
    void (async () => {
      const { suggestions: list, live } = await api.personas.analyze();
      setSuggestions(list);
      setAnalyzeLive(live);
    })();
  }, []);

  async function handleArchive(role: string) {
    if (!confirm(`Archive ${role}?`)) return;
    try {
      await api.agents.archiveRole(role);
    } catch (err) {
      if (!(err instanceof ApiError) || (err.status !== 404 && err.status !== 0)) {
        alert(`Failed: ${(err as Error).message}`);
        return;
      }
    }
    setAgents((prev) => prev.filter((a) => a.role !== role));
  }

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Agents</h2>
        <Button size="sm" variant="outline" onClick={() => setShowNew(true)} className="gap-1">
          <Plus className="size-3.5" />
          New role
        </Button>
      </div>
      <Separator className="my-3" />

      <div className="space-y-1.5">
        {!loaded && (
          <div className="text-[12px] text-muted-foreground">Loading…</div>
        )}
        {loaded && agents.length === 0 && (
          <div className="text-[12px] text-muted-foreground">No agent roles yet.</div>
        )}
        {agents.map((a) => (
          <div
            key={a.role}
            className="flex items-center justify-between rounded-md px-2 py-1.5 text-[13px] hover:bg-secondary/40"
          >
            <div className="flex items-center gap-2">
              <span className="font-medium">{a.name}</span>
              <span className="text-[11px] text-muted-foreground">@{a.role}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-[11px] text-muted-foreground">
                {a.activeSessions}/{a.maxConcurrency}
              </span>
              <DropdownMenu>
                <DropdownMenuTrigger
                  className="rounded p-1 text-muted-foreground hover:bg-secondary/70 hover:text-foreground"
                  aria-label="Role actions"
                >
                  <MoreHorizontal className="size-3.5" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => setEditing(a.role)}>
                    Edit persona
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleArchive(a.role)}>
                    Archive
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-5 rounded-lg border border-border/70 bg-secondary/20 p-3">
        <div className="flex items-center justify-between">
          <div className="text-[12px] font-semibold">Scope health</div>
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {analyzeLive ? "live" : "mock"}
          </span>
        </div>
        <div className="mt-2 space-y-2">
          {suggestions.length === 0 && (
            <div className="text-[12px] text-muted-foreground">
              No suggestions — scope looks clean.
            </div>
          )}
          {suggestions.map((s) => (
            <div key={s.id} className="text-[12px]">
              <div className="font-medium">{s.title}</div>
              <div className="text-muted-foreground">{s.rationale}</div>
            </div>
          ))}
        </div>
      </div>

      <NewRoleDialog open={showNew} onOpenChange={setShowNew} onCreated={refresh} />

      <Dialog open={editing != null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit persona — {editing}</DialogTitle>
          </DialogHeader>
          {editing && <PersonaEditor role={editing} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
