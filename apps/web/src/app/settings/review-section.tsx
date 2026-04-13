"use client";

/**
 * Review policy editor — client component for the settings page.
 * Reads/writes /api/v1/config/review: default policy + per-role overrides.
 */

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { api, ApiError } from "@/lib/api";
import type { AgentStatus, ReviewConfigResponse } from "@/lib/types";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const POLICIES = [
  "strict",
  "normal",
  "lax",
  "autonomous",
  "peer-review",
] as const;
type Policy = (typeof POLICIES)[number];

interface Draft {
  default: Policy;
  roles: Record<string, Policy>;
}

export function ReviewSection() {
  const [data, setData] = useState<ReviewConfigResponse | null>(null);
  const [agents, setAgents] = useState<AgentStatus[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      const [reviewRes, agentList] = await Promise.all([
        api.config.getReview(),
        api.agents.list(),
      ]);
      setData(reviewRes);
      setAgents(agentList);
      setDraft({
        default: (reviewRes.config.default || reviewRes.resolvedDefault) as Policy,
        roles: { ...reviewRes.config.roles } as Record<string, Policy>,
      });
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

  const dirty = useMemo(() => {
    if (!data || !draft) return false;
    const orig: Draft = {
      default: (data.config.default || data.resolvedDefault) as Policy,
      roles: { ...data.config.roles } as Record<string, Policy>,
    };
    if (orig.default !== draft.default) return true;
    const allRoles = new Set([...Object.keys(orig.roles), ...Object.keys(draft.roles)]);
    for (const r of allRoles) {
      if (orig.roles[r] !== draft.roles[r]) return true;
    }
    return false;
  }, [data, draft]);

  async function onSave() {
    if (!draft) return;
    setSaving(true);
    try {
      const patch: { default?: string; roles?: Record<string, string> } = {};
      if (data && draft.default !== (data.config.default || data.resolvedDefault)) {
        patch.default = draft.default;
      }
      // Always send roles to allow clearing overrides
      const rolesPatch: Record<string, string> = {};
      for (const agent of agents) {
        const val = draft.roles[agent.role];
        if (val) {
          rolesPatch[agent.role] = val;
        }
      }
      if (Object.keys(rolesPatch).length > 0 || Object.keys(data?.config.roles ?? {}).length > 0) {
        patch.roles = rolesPatch;
      }
      await api.config.updateReview(patch);
      toast.success("Review policy saved");
      await refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : (err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="rounded-xl border border-border bg-card p-5">
        <h2 className="text-sm font-semibold">Review Policy</h2>
        <Separator className="my-3" />
        <p className="text-sm text-muted-foreground">Loading review config...</p>
      </div>
    );
  }

  if (error || !data || !draft) {
    return (
      <div className="rounded-xl border border-border bg-card p-5">
        <h2 className="text-sm font-semibold">Review Policy</h2>
        <Separator className="my-3" />
        <p className="text-sm text-status-failed">
          Failed to load review config: {error ?? "unknown error"}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Review Policy</h2>
        <span className="text-xs text-muted-foreground">config/review.yaml</span>
      </div>
      <Separator className="my-3" />

      <div className="space-y-4">
        {/* Default policy */}
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Default policy
          </h3>
          <div className="mt-2">
            <Select<Policy>
              value={draft.default}
              onValueChange={(v) => v && setDraft((d) => (d ? { ...d, default: v } : d))}
            >
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {POLICIES.map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Per-role overrides */}
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Per-role overrides
          </h3>
          <div className="mt-2 space-y-2">
            {agents.length === 0 && (
              <p className="text-xs text-muted-foreground">No agents registered.</p>
            )}
            {agents.map((a) => (
              <div
                key={a.role}
                className="flex items-center gap-3 rounded-md border border-border bg-background/40 p-2"
              >
                <span className="w-28 text-xs font-medium">{a.name}</span>
                <span className="text-[11px] text-muted-foreground">@{a.role}</span>
                <div className="flex-1" />
                <Select<string>
                  value={draft.roles[a.role] ?? ""}
                  onValueChange={(v) =>
                    setDraft((d) => {
                      if (!d) return d;
                      const roles = { ...d.roles };
                      if (v) {
                        roles[a.role] = v as Policy;
                      } else {
                        delete roles[a.role];
                      }
                      return { ...d, roles };
                    })
                  }
                >
                  <SelectTrigger className="w-40">
                    <SelectValue placeholder="(inherit default)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">
                      (inherit default)
                    </SelectItem>
                    {POLICIES.map((p) => (
                      <SelectItem key={p} value={p}>
                        {p}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
        </div>
      </div>

      <Separator className="my-4" />

      <div className="flex justify-end">
        <Button
          type="button"
          size="sm"
          onClick={onSave}
          disabled={!dirty || saving}
        >
          {saving ? "Saving..." : "Save changes"}
        </Button>
      </div>
    </div>
  );
}
