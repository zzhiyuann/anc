import type {
  Agent,
  AgentDetail,
  Task,
  AncEvent,
  QueueState,
  SystemHealth,
} from "./types";

const BASE = "/api/v1";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...init?.headers },
    ...init,
  });
  if (!res.ok) {
    throw new Error(`API ${res.status}: ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

// --- Agents ---

export function getAgents() {
  return request<Agent[]>("/agents");
}

export function getAgent(role: string) {
  return request<AgentDetail>(`/agents/${role}`);
}

export function startAgent(role: string, issueKey: string) {
  return request<{ ok: boolean }>(`/agents/${role}/start`, {
    method: "POST",
    body: JSON.stringify({ issueKey }),
  });
}

export function talkToAgent(role: string, message: string) {
  return request<{ ok: boolean }>(`/agents/${role}/talk`, {
    method: "POST",
    body: JSON.stringify({ message }),
  });
}

export function getAgentOutput(role: string) {
  return request<{ lines: string[] }>(`/agents/${role}/output`);
}

export function getAgentMemory(role: string) {
  return request<{ files: { filename: string; content: string; updatedAt: string; sizeBytes: number }[] }>(
    `/agents/${role}/memory`
  );
}

// --- Tasks ---

export function getTasks(status?: string) {
  const qs = status ? `?status=${status}` : "";
  return request<Task[]>(`/tasks${qs}`);
}

export function createTask(data: {
  title: string;
  description: string;
  agent?: string;
  priority?: string;
}) {
  return request<Task>("/tasks", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function deleteTask(id: string) {
  return request<{ ok: boolean }>(`/tasks/${id}`, { method: "DELETE" });
}

// --- Queue ---

export function getQueue() {
  return request<QueueState>("/queue");
}

// --- Health ---

export function getHealth() {
  return request<SystemHealth>("/health/detailed");
}

// --- Events ---

export function getEvents() {
  return request<AncEvent[]>("/events");
}
