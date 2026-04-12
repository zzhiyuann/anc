/**
 * API client for the anc backend. All endpoints mirror src/api/routes.ts.
 *
 * Base URL resolution:
 *   - Browser: relative /api/v1 (Next.js rewrites proxy to localhost:3848)
 *   - Server (SSR / static export): NEXT_PUBLIC_API_URL, default http://localhost:3848
 *
 * Response envelopes are unwrapped here so callers get clean arrays/objects.
 */

import type {
  AgentStatus,
  AgentStatusDetail,
  TaskRow,
  TaskDetail,
  CreateTaskResponse,
  QueueItem,
  EventRow,
  MemoryList,
  AgentOutput,
} from "./types";

// --- Base URL + fetch wrapper ---

function baseUrl(): string {
  // On the server (SSR / prerender), we can't use relative URLs.
  if (typeof window === "undefined") {
    const backend =
      process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3848";
    return `${backend}/api/v1`;
  }
  // Browser: use the Next.js proxy in next.config.ts.
  return "/api/v1";
}

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "ApiError";
  }
}

interface RequestOptions {
  method?: "GET" | "POST" | "DELETE" | "PUT" | "PATCH";
  body?: unknown;
  signal?: AbortSignal;
  // Never cache dashboard data — it's always real-time.
  cache?: RequestCache;
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const url = `${baseUrl()}${path}`;
  const init: RequestInit = {
    method: opts.method ?? "GET",
    headers: { "Content-Type": "application/json" },
    cache: opts.cache ?? "no-store",
    signal: opts.signal,
  };
  if (opts.body !== undefined) {
    init.body = JSON.stringify(opts.body);
  }

  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    throw new ApiError(0, `Network error: ${(err as Error).message}`);
  }

  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const errorBody = (await res.json()) as { error?: string; message?: string };
      if (errorBody.error) message = errorBody.error;
      else if (errorBody.message) message = errorBody.message;
    } catch {
      // Body not JSON — use statusText.
    }
    throw new ApiError(res.status, message);
  }

  // 204 No Content / empty body.
  const contentType = res.headers.get("content-type") ?? "";
  if (res.status === 204 || !contentType.includes("application/json")) {
    return undefined as T;
  }

  return (await res.json()) as T;
}

// --- Agents ---

export const agents = {
  async list(signal?: AbortSignal): Promise<AgentStatus[]> {
    const { agents } = await request<{ agents: AgentStatus[] }>("/agents", { signal });
    return agents;
  },

  async get(role: string, signal?: AbortSignal): Promise<AgentStatusDetail> {
    return request<AgentStatusDetail>(`/agents/${encodeURIComponent(role)}`, { signal });
  },

  async start(role: string, issueKey: string): Promise<{ action: string; [k: string]: unknown }> {
    return request(`/agents/${encodeURIComponent(role)}/start`, {
      method: "POST",
      body: { issueKey },
    });
  },

  async stop(role: string): Promise<{ ok: true; stopped: number }> {
    return request(`/agents/${encodeURIComponent(role)}/stop`, { method: "POST" });
  },

  async talk(role: string, message: string): Promise<{ ok: true; sent: number; total: number }> {
    return request(`/agents/${encodeURIComponent(role)}/talk`, {
      method: "POST",
      body: { message },
    });
  },

  async output(role: string, lines = 50, signal?: AbortSignal): Promise<AgentOutput[]> {
    const qs = `?lines=${lines}`;
    const { outputs } = await request<{ outputs: AgentOutput[] }>(
      `/agents/${encodeURIComponent(role)}/output${qs}`,
      { signal },
    );
    return outputs;
  },

  async memory(role: string, signal?: AbortSignal): Promise<MemoryList> {
    return request<MemoryList>(`/agents/${encodeURIComponent(role)}/memory`, { signal });
  },
};

// --- Tasks ---

export interface CreateTaskInput {
  title: string;
  description?: string;
  agent?: string;
  priority?: number;
}

export const tasks = {
  async list(
    filters: { status?: string; agent?: string } = {},
    signal?: AbortSignal,
  ): Promise<TaskRow[]> {
    const params = new URLSearchParams();
    if (filters.status) params.set("status", filters.status);
    if (filters.agent) params.set("agent", filters.agent);
    const qs = params.toString() ? `?${params.toString()}` : "";
    const { tasks } = await request<{ tasks: TaskRow[] }>(`/tasks${qs}`, { signal });
    return tasks;
  },

  async get(id: string, signal?: AbortSignal): Promise<TaskDetail> {
    return request<TaskDetail>(`/tasks/${encodeURIComponent(id)}`, { signal });
  },

  async create(input: CreateTaskInput): Promise<CreateTaskResponse> {
    return request<CreateTaskResponse>("/tasks", { method: "POST", body: input });
  },

  async remove(id: string): Promise<{ ok: true; killed: string }> {
    return request(`/tasks/${encodeURIComponent(id)}`, { method: "DELETE" });
  },

  async resume(id: string): Promise<{ action: string; [k: string]: unknown }> {
    return request(`/tasks/${encodeURIComponent(id)}/resume`, { method: "POST" });
  },
};

// --- Queue ---

export const queue = {
  async list(
    status?: "queued" | "processing",
    signal?: AbortSignal,
  ): Promise<QueueItem[]> {
    const qs = status ? `?status=${status}` : "";
    const { items } = await request<{ items: QueueItem[] }>(`/queue${qs}`, { signal });
    return items;
  },

  async cancel(id: string): Promise<{ ok: true }> {
    return request(`/queue/${encodeURIComponent(id)}`, { method: "DELETE" });
  },
};

// --- Events ---

export const events = {
  async list(limit = 50, signal?: AbortSignal): Promise<EventRow[]> {
    const { events } = await request<{ events: EventRow[] }>(`/events?limit=${limit}`, {
      signal,
    });
    return events;
  },
};

// --- Memory ---

export const memory = {
  async shared(signal?: AbortSignal): Promise<string[]> {
    const { files } = await request<{ files: string[] }>("/memory/shared", { signal });
    return files;
  },

  async forRole(role: string, signal?: AbortSignal): Promise<MemoryList> {
    return request<MemoryList>(`/memory/${encodeURIComponent(role)}`, { signal });
  },
};

// --- Unified default export ---

export const api = { agents, tasks, queue, events, memory };

export default api;
