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
  Task,
  TaskFull,
  TaskComment,
  TaskAttachment,
  Project,
  ProjectStats,
  ProjectWithStats,
  SessionOnTask,
  AncNotification,
} from "./types";
import {
  mockTask,
  mockTaskFull,
  mockTaskComments,
  mockProject,
  mockProjectsWithStats,
  mockNotifications,
} from "./mock-data";

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

/**
 * If the backend returns 404 (Wave 2A endpoint not yet merged) or a network
 * error, fall back to a mock value so the dashboard still renders. Any other
 * error (500, validation, etc.) is rethrown so real bugs surface.
 */
async function withMockFallback<T>(fn: () => Promise<T>, mock: T, label: string): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 0)) {
      if (typeof console !== "undefined") {
        console.warn(`[api] ${label} unavailable (${err.status}), using mock fallback`);
      }
      return mock;
    }
    throw err;
  }
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

  // --- New task-entity API (Wave 2A) ---

  /**
   * GET /api/v1/tasks/:id — full task detail bundle.
   * Falls back to mockTaskFull when backend endpoint is not yet deployed.
   */
  async getFull(id: string, signal?: AbortSignal): Promise<TaskFull> {
    return withMockFallback(
      () => request<TaskFull>(`/tasks/${encodeURIComponent(id)}/full`, { signal }),
      { ...mockTaskFull, task: { ...mockTaskFull.task, id } },
      `tasks.getFull(${id})`,
    );
  },

  /**
   * GET /api/v1/tasks?projectId=… — first-class Task entities for a project.
   * Distinct from tasks.list() which returns the legacy session-based TaskRow.
   */
  async listByProject(projectId: string, signal?: AbortSignal): Promise<Task[]> {
    return withMockFallback(
      async () => {
        const res = await request<{ tasks: Task[] }>(
          `/tasks?projectId=${encodeURIComponent(projectId)}`,
          { signal },
        );
        return res.tasks;
      },
      [mockTask],
      `tasks.listByProject(${projectId})`,
    );
  },
};

// --- Task sub-resources (comments, attachments, dispatch) ---

export const taskComments = {
  async list(taskId: string, signal?: AbortSignal): Promise<TaskComment[]> {
    return withMockFallback(
      async () => {
        const res = await request<{ comments: TaskComment[] }>(
          `/tasks/${encodeURIComponent(taskId)}/comments`,
          { signal },
        );
        return res.comments;
      },
      mockTaskComments,
      `taskComments.list(${taskId})`,
    );
  },

  async create(taskId: string, body: string, parentId?: number): Promise<TaskComment> {
    const res = await request<{ comment: TaskComment }>(
      `/tasks/${encodeURIComponent(taskId)}/comments`,
      { method: "POST", body: { body, parentId } },
    );
    return res.comment;
  },
};

export const taskAttachments = {
  async list(taskId: string, signal?: AbortSignal): Promise<TaskAttachment[]> {
    return withMockFallback(
      async () => {
        const res = await request<{ attachments: TaskAttachment[] }>(
          `/tasks/${encodeURIComponent(taskId)}/attachments`,
          { signal },
        );
        return res.attachments;
      },
      [],
      `taskAttachments.list(${taskId})`,
    );
  },

  /** Fetch raw text content of an attachment. Caller should handle binary via url(). */
  async read(taskId: string, filename: string): Promise<string> {
    const url = `${baseUrl()}/tasks/${encodeURIComponent(taskId)}/attachments/${encodeURIComponent(filename)}`;
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) throw new ApiError(r.status, `attachment ${filename}: ${r.statusText}`);
    return r.text();
  },

  /** Build the URL for an attachment (useful for <img src> / <a href>). */
  url(taskId: string, filename: string): string {
    return `${baseUrl()}/tasks/${encodeURIComponent(taskId)}/attachments/${encodeURIComponent(filename)}`;
  },
};

export const taskDispatch = {
  /**
   * POST /api/v1/tasks/:id/dispatch — attach a new agent session to an existing task.
   */
  async dispatch(taskId: string, role: string, context?: string): Promise<SessionOnTask> {
    const res = await request<{ session: SessionOnTask }>(
      `/tasks/${encodeURIComponent(taskId)}/dispatch`,
      { method: "POST", body: { role, context } },
    );
    return res.session;
  },
};

// --- Projects ---

export const projects = {
  async list(signal?: AbortSignal): Promise<ProjectWithStats[]> {
    return withMockFallback(
      async () => {
        const res = await request<{ projects: ProjectWithStats[] }>("/projects", { signal });
        return res.projects;
      },
      mockProjectsWithStats,
      "projects.list()",
    );
  },

  async get(
    id: string,
    signal?: AbortSignal,
  ): Promise<{ project: Project; recentTasks: Task[]; stats: ProjectStats }> {
    return withMockFallback(
      () =>
        request<{ project: Project; recentTasks: Task[]; stats: ProjectStats }>(
          `/projects/${encodeURIComponent(id)}`,
          { signal },
        ),
      {
        project: { ...mockProject, id },
        recentTasks: [mockTask],
        stats: { total: 1, running: 1, queued: 0, done: 0, totalCostUsd: 0 },
      },
      `projects.get(${id})`,
    );
  },

  async create(input: {
    name: string;
    description?: string;
    color?: string;
    icon?: string;
  }): Promise<Project> {
    const res = await request<{ project: Project }>("/projects", {
      method: "POST",
      body: input,
    });
    return res.project;
  },

  async update(id: string, patch: Partial<Project>): Promise<Project> {
    const res = await request<{ project: Project }>(
      `/projects/${encodeURIComponent(id)}`,
      { method: "PATCH", body: patch },
    );
    return res.project;
  },

  async archive(id: string): Promise<void> {
    await request(`/projects/${encodeURIComponent(id)}`, { method: "DELETE" });
  },
};

// --- Notifications ---

export const notifications = {
  async list(
    filter: "unread" | "all" | "archive" = "unread",
    signal?: AbortSignal,
  ): Promise<{ notifications: AncNotification[]; unreadCount: number }> {
    return withMockFallback(
      () =>
        request<{ notifications: AncNotification[]; unreadCount: number }>(
          `/notifications?filter=${filter}`,
          { signal },
        ),
      {
        notifications: mockNotifications,
        unreadCount: mockNotifications.filter((n) => n.readAt === null).length,
      },
      `notifications.list(${filter})`,
    );
  },

  async unreadCount(signal?: AbortSignal): Promise<number> {
    return withMockFallback(
      async () => {
        const res = await request<{ count: number }>("/notifications/unread-count", { signal });
        return res.count;
      },
      mockNotifications.filter((n) => n.readAt === null).length,
      "notifications.unreadCount()",
    );
  },

  async markRead(id: number): Promise<void> {
    await request(`/notifications/${id}/read`, { method: "POST" });
  },

  async archive(id: number): Promise<void> {
    await request(`/notifications/${id}/archive`, { method: "POST" });
  },

  async markAllRead(): Promise<void> {
    await request("/notifications/mark-all-read", { method: "POST" });
  },
};

// --- Queue ---

export const queue = {
  async list(
    status?: "queued" | "processing",
    signal?: AbortSignal,
  ): Promise<QueueItem[]> {
    const qs = status ? `?status=${status}` : "";
    const { queue: items } = await request<{ queue: QueueItem[] }>(`/queue${qs}`, { signal });
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

// --- System (placeholder grouping for future endpoints) ---

export const system = {};

// --- Unified default export ---

export const api = {
  agents,
  tasks,
  projects,
  notifications,
  taskComments,
  taskAttachments,
  taskDispatch,
  queue,
  events,
  memory,
  system,
};

export default api;
