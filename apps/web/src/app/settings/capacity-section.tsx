"use client";

/**
 * Agent capacity editor — client component for the settings page.
 * Reads agent list and allows editing maxConcurrency per agent via
 * PATCH /api/v1/agents/roles/:role.
 */

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, ApiError } from "@/lib/api";
import type { AgentStatus } from "@/lib/types";

interface AgentDraft {
  role: string;
  name: string;
  activeSessions: number;
  maxConcurrency: number;
  saving: boolean;
}

export function CapacitySection() {
  const [agents, setAgents] = useState<AgentDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      const list = await api.agents.list();
      setAgents(
        list.map((a) => ({
          role: a.role,
          name: a.name,
          activeSessions: a.activeSessions,
          maxConcurrency: a.maxConcurrency,
          saving: false,
        })),
      );
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  function updateMaxConcurrency(role: string, value: number) {
    setAgents((prev) =>
      prev.map((a) =>
        a.role === role ? { ...a, maxConcurrency: value } : a,
      ),
    );
  }

  async function handleSave(role: string) {
    const agent = agents.find((a) => a.role === role);
    if (!agent) return;

    setAgents((prev) =>
      prev.map((a) => (a.role === role ? { ...a, saving: true } : a)),
    );
    try {
      await api.agents.updateConfig(role, {
        maxConcurrency: agent.maxConcurrency,
      });
      toast.success(`Updated ${agent.name} capacity`);
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : (err as Error).message,
      );
    } finally {
      setAgents((prev) =>
        prev.map((a) => (a.role === role ? { ...a, saving: false } : a)),
      );
    }
  }

  if (loading) {
    return (
      <div className="rounded-xl border border-border bg-card p-5">
        <h2 className="text-sm font-semibold">Agent Capacity</h2>
        <Separator className="my-3" />
        <p className="text-sm text-muted-foreground">Loading agents...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-border bg-card p-5">
        <h2 className="text-sm font-semibold">Agent Capacity</h2>
        <Separator className="my-3" />
        <p className="text-sm text-status-failed">
          Failed to load agents: {error}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <h2 className="text-sm font-semibold">Agent Capacity</h2>
      <Separator className="my-3" />
      <div className="space-y-2">
        {agents.length === 0 && (
          <p className="text-xs text-muted-foreground">No agents registered.</p>
        )}
        {agents.map((a) => (
          <div
            key={a.role}
            className="flex items-center gap-3 rounded-md border border-border bg-background/40 p-2"
          >
            <span className="w-28 text-xs font-medium">{a.name}</span>
            <span className="text-xs text-muted-foreground">
              {a.activeSessions} active /
            </span>
            <label className="text-xs">
              <span className="sr-only">Max concurrency for {a.name}</span>
              <Input
                type="number"
                min={1}
                max={10}
                value={a.maxConcurrency}
                onChange={(e) =>
                  updateMaxConcurrency(
                    a.role,
                    Math.max(1, Math.min(10, parseInt(e.target.value, 10) || 1)),
                  )
                }
                className="h-7 w-16 font-mono"
              />
            </label>
            <span className="text-xs text-muted-foreground">max</span>
            <div className="flex-1" />
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={a.saving}
              onClick={() => handleSave(a.role)}
            >
              {a.saving ? "Saving..." : "Save"}
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
