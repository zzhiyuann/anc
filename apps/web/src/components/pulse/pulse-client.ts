/**
 * Pulse-only HTTP helpers for endpoints not exposed via the shared lib/api.ts.
 *
 * lib/api.ts is owned by another agent and frozen for this depth pass, so
 * everything that needs PATCH /pulse/key-results/:id, GET /kill-switch/status,
 * POST /kill-switch/resume, briefing(?force=1), or POST objective key-results
 * lives here.
 *
 * Base-URL resolution mirrors lib/api.ts:
 *   - Browser: relative /api/v1 (Next.js rewrites proxy to the gateway)
 *   - SSR: NEXT_PUBLIC_API_URL, default http://localhost:3849
 */

import type { DailyBriefing, KeyResult, Objective } from "@/lib/types";

function baseUrl(): string {
  if (typeof window === "undefined") {
    const backend = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3849";
    return `${backend}/api/v1`;
  }
  return "/api/v1";
}

export class PulseError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "PulseError";
  }
}

async function req<T>(
  path: string,
  init: RequestInit & { json?: unknown } = {},
): Promise<T> {
  const url = `${baseUrl()}${path}`;
  const { json: body, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(url, {
      ...rest,
      headers: {
        "Content-Type": "application/json",
        ...(rest.headers as Record<string, string> | undefined),
      },
      cache: "no-store",
      body: body !== undefined ? JSON.stringify(body) : (rest.body as BodyInit | undefined),
    });
  } catch (err) {
    throw new PulseError(0, `Network error: ${(err as Error).message}`);
  }
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const j = (await res.json()) as { error?: string; message?: string };
      msg = j.error ?? j.message ?? msg;
    } catch {
      // not JSON
    }
    throw new PulseError(res.status, msg);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// --- Briefing (no-op force flag — backend caches 1h, but we still re-fetch
//     to refresh wall-clock and pick up any changes if the cache expired) ---
export async function fetchBriefing(): Promise<DailyBriefing> {
  return req<DailyBriefing>(`/pulse/briefing?ts=${Date.now()}`);
}

// --- Objectives ---
export async function listObjectivesRaw(quarter?: string): Promise<Objective[]> {
  const qs = quarter ? `?quarter=${encodeURIComponent(quarter)}` : "";
  const res = await req<{ objectives: Objective[] }>(`/pulse/objectives${qs}`);
  return res.objectives;
}

export async function createObjectiveRaw(input: {
  title: string;
  description?: string;
  quarter: string;
}): Promise<Objective> {
  const res = await req<{ objective: Objective }>(`/pulse/objectives`, {
    method: "POST",
    json: input,
  });
  return res.objective;
}

export async function addKeyResultRaw(
  objectiveId: string,
  input: { title: string; metric: string; target: number },
): Promise<KeyResult> {
  const res = await req<{ keyResult: KeyResult }>(
    `/pulse/objectives/${encodeURIComponent(objectiveId)}/key-results`,
    { method: "POST", json: input },
  );
  return res.keyResult;
}

export async function updateKeyResultRaw(
  id: string,
  current: number,
): Promise<KeyResult> {
  const res = await req<{ keyResult: KeyResult }>(
    `/pulse/key-results/${encodeURIComponent(id)}`,
    { method: "PATCH", json: { current } },
  );
  return res.keyResult;
}

// --- Kill switch ---
export async function killSwitchStatus(): Promise<{ paused: boolean }> {
  return req<{ paused: boolean }>(`/kill-switch/status`);
}

export async function killSwitchPauseRaw(): Promise<{
  ok: true;
  alreadyPaused: boolean;
  suspended: number;
  failed: number;
}> {
  return req(`/kill-switch/pause`, { method: "POST" });
}

export async function killSwitchResumeRaw(): Promise<{
  ok: true;
  wasPaused: boolean;
}> {
  return req(`/kill-switch/resume`, { method: "POST" });
}
