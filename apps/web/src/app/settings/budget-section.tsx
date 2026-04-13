"use client";

/**
 * Budget config editor — client component for the settings page.
 * Reads/writes /api/v1/config/budget and surfaces unlimited mode
 * (ANC_BUDGET_DISABLED env var) as a banner.
 */

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, ApiError } from "@/lib/api";
import type {
  BudgetConfig,
  BudgetConfigPatch,
  BudgetConfigResponse,
} from "@/lib/types";

const KNOWN_AGENT_ROLES = ["engineer", "strategist", "ops"];

interface DraftAgentRow {
  role: string;
  limit: number;
  alertAt: number;
}

interface Draft {
  dailyLimit: number;
  dailyAlertAt: number;
  agents: DraftAgentRow[];
}

function toDraft(config: BudgetConfig): Draft {
  return {
    dailyLimit: config.daily.limit,
    dailyAlertAt: config.daily.alertAt,
    agents: Object.entries(config.agents)
      .map(([role, v]) => ({ role, limit: v.limit, alertAt: v.alertAt }))
      .sort((a, b) => a.role.localeCompare(b.role)),
  };
}

function draftsEqual(a: Draft, b: Draft): boolean {
  if (a.dailyLimit !== b.dailyLimit || a.dailyAlertAt !== b.dailyAlertAt) return false;
  if (a.agents.length !== b.agents.length) return false;
  for (let i = 0; i < a.agents.length; i++) {
    const x = a.agents[i];
    const y = b.agents[i];
    if (x.role !== y.role || x.limit !== y.limit || x.alertAt !== y.alertAt) return false;
  }
  return true;
}

function buildPatch(original: BudgetConfig, draft: Draft): BudgetConfigPatch {
  const patch: BudgetConfigPatch = {};
  if (
    draft.dailyLimit !== original.daily.limit ||
    draft.dailyAlertAt !== original.daily.alertAt
  ) {
    patch.daily = { limit: draft.dailyLimit, alertAt: draft.dailyAlertAt };
  }

  const agents: NonNullable<BudgetConfigPatch["agents"]> = {};
  const draftRoles = new Set(draft.agents.map(a => a.role));
  // Deletions
  for (const role of Object.keys(original.agents)) {
    if (!draftRoles.has(role)) agents[role] = null;
  }
  // Adds / updates
  for (const row of draft.agents) {
    const o = original.agents[row.role];
    if (!o || o.limit !== row.limit || o.alertAt !== row.alertAt) {
      agents[row.role] = { limit: row.limit, alertAt: row.alertAt };
    }
  }
  if (Object.keys(agents).length > 0) patch.agents = agents;
  return patch;
}

export function BudgetSection() {
  const [data, setData] = useState<BudgetConfigResponse | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      const res = await api.config.getBudget();
      setData(res);
      setDraft(toDraft(res.config));
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
    return !draftsEqual(toDraft(data.config), draft);
  }, [data, draft]);

  if (loading) {
    return (
      <div className="rounded-xl border border-border bg-card p-5">
        <h2 className="text-sm font-semibold">Budget</h2>
        <Separator className="my-3" />
        <p className="text-sm text-muted-foreground">Loading budget config...</p>
      </div>
    );
  }

  if (error || !data || !draft) {
    return (
      <div className="rounded-xl border border-border bg-card p-5">
        <h2 className="text-sm font-semibold">Budget</h2>
        <Separator className="my-3" />
        <p className="text-sm text-status-failed">
          Failed to load budget config: {error ?? "unknown error"}
        </p>
      </div>
    );
  }

  const todayPercent = data.summary.today.limit > 0
    ? Math.min(100, Math.round((data.summary.today.spent / data.summary.today.limit) * 100))
    : 0;

  const knownAgentsToAdd = KNOWN_AGENT_ROLES.filter(
    r => !draft.agents.some(a => a.role === r),
  );

  function updateDailyLimit(v: number) {
    setDraft(d => (d ? { ...d, dailyLimit: v } : d));
  }
  function updateDailyAlert(v: number) {
    setDraft(d => (d ? { ...d, dailyAlertAt: v } : d));
  }
  function updateAgent(role: string, patch: Partial<DraftAgentRow>) {
    setDraft(d =>
      d
        ? {
            ...d,
            agents: d.agents.map(a => (a.role === role ? { ...a, ...patch } : a)),
          }
        : d,
    );
  }
  function removeAgent(role: string) {
    setDraft(d => (d ? { ...d, agents: d.agents.filter(a => a.role !== role) } : d));
  }
  function addAgent(role: string) {
    setDraft(d =>
      d
        ? {
            ...d,
            agents: [...d.agents, { role, limit: 10, alertAt: 0.8 }].sort((a, b) =>
              a.role.localeCompare(b.role),
            ),
          }
        : d,
    );
  }

  async function onSave() {
    if (!data || !draft) return;
    const patch = buildPatch(data.config, draft);
    if (Object.keys(patch).length === 0) {
      toast.info("No changes to save");
      return;
    }
    setSaving(true);
    try {
      await api.config.updateBudget(patch);
      toast.success("Budget config saved");
      await refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : (err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function onReset() {
    if (typeof window !== "undefined") {
      const ok = window.confirm(
        "Reset today's spend? This will delete every budget_log row from today (testing only).",
      );
      if (!ok) return;
    }
    try {
      await api.config.resetTodayBudget();
      toast.success("Today's spend reset");
      await refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : (err as Error).message);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Budget</h2>
        <span className="text-xs text-muted-foreground">config/budget.yaml</span>
      </div>
      <Separator className="my-3" />

      {data.disabled && (
        <div className="mb-4 rounded-md border border-yellow-500/40 bg-yellow-500/10 p-3 text-xs text-yellow-900 dark:text-yellow-200">
          <strong className="font-semibold">Unlimited mode active.</strong>{" "}
          Budget checks are bypassed via the <code>ANC_BUDGET_DISABLED</code> env
          var. Restart anc with the variable unset to re-enable enforcement. The
          values below are still editable and will take effect when enforcement
          resumes.
        </div>
      )}

      {/* Daily section */}
      <div className="space-y-4">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Daily limit
          </h3>
          <div className="mt-2 grid grid-cols-2 gap-3">
            <label className="text-xs">
              <span className="block text-muted-foreground">Limit (USD)</span>
              <Input
                type="number"
                min={0}
                step="0.01"
                value={draft.dailyLimit}
                onChange={e => updateDailyLimit(parseFloat(e.target.value) || 0)}
                className="mt-1 font-mono"
              />
            </label>
            <label className="text-xs">
              <span className="block text-muted-foreground">
                Alert at {Math.round(draft.dailyAlertAt * 100)}%
              </span>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={Math.round(draft.dailyAlertAt * 100)}
                onChange={e => updateDailyAlert(parseInt(e.target.value, 10) / 100)}
                className="mt-2 w-full"
              />
            </label>
          </div>

          {/* Live usage bar */}
          <div className="mt-3">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Today</span>
              <span className="font-mono">
                ${data.summary.today.spent.toFixed(2)} / ${data.summary.today.limit.toFixed(2)} ({todayPercent}%)
              </span>
            </div>
            <div className="mt-1 h-2 w-full overflow-hidden rounded bg-muted">
              <div
                className={`h-full transition-all ${
                  todayPercent >= 100
                    ? "bg-status-failed"
                    : todayPercent >= Math.round(draft.dailyAlertAt * 100)
                    ? "bg-yellow-500"
                    : "bg-status-active"
                }`}
                style={{ width: `${todayPercent}%` }}
              />
            </div>
          </div>
        </div>

        {/* Per-agent section */}
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Per-agent caps
          </h3>
          <div className="mt-2 space-y-2">
            {draft.agents.length === 0 && (
              <p className="text-xs text-muted-foreground">
                No per-agent caps configured.
              </p>
            )}
            {draft.agents.map(row => {
              const usage = data.summary.perAgent[row.role];
              return (
                <div
                  key={row.role}
                  className="flex items-center gap-2 rounded-md border border-border bg-background/40 p-2"
                >
                  <span className="w-24 text-xs font-medium">{row.role}</span>
                  <label className="text-xs">
                    <span className="block text-muted-foreground">Limit</span>
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      value={row.limit}
                      onChange={e =>
                        updateAgent(row.role, { limit: parseFloat(e.target.value) || 0 })
                      }
                      className="mt-1 h-7 w-24 font-mono"
                    />
                  </label>
                  <label className="flex-1 text-xs">
                    <span className="block text-muted-foreground">
                      Alert at {Math.round(row.alertAt * 100)}%
                    </span>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={5}
                      value={Math.round(row.alertAt * 100)}
                      onChange={e =>
                        updateAgent(row.role, {
                          alertAt: parseInt(e.target.value, 10) / 100,
                        })
                      }
                      className="mt-2 w-full"
                    />
                  </label>
                  <div className="w-28 text-right font-mono text-xs text-muted-foreground">
                    {usage
                      ? `$${usage.spent.toFixed(2)} today`
                      : "—"}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => removeAgent(row.role)}
                    aria-label={`Remove ${row.role} budget`}
                  >
                    Delete
                  </Button>
                </div>
              );
            })}
          </div>

          {knownAgentsToAdd.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">Add:</span>
              {knownAgentsToAdd.map(role => (
                <Button
                  key={role}
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => addAgent(role)}
                >
                  + {role}
                </Button>
              ))}
            </div>
          )}
        </div>
      </div>

      <Separator className="my-4" />

      <div className="flex items-center justify-between">
        <Button type="button" variant="outline" size="sm" onClick={onReset}>
          Reset today&apos;s spend
        </Button>
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
