import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { AgentStatus, SessionState } from "./types";
import type { UiStatus } from "@/components/status-badge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * If a string looks like a raw UUID / task-UUID, return a shortened
 * human-readable form: "task-7e31..." (max 12 chars). Otherwise return as-is.
 */
export function shortenIfUuid(s: string): string {
  // Match task-<uuid> or migrated-task-<uuid> or bare UUID
  const uuidRe = /^(?:(?:migrated-)?task-)?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
  const m = uuidRe.exec(s);
  if (m) return `task-${m[1].slice(0, 8)}...`;
  // Catch any string > 20 chars that is mostly hex+dashes (likely a raw ID)
  if (s.length > 20 && /^[0-9a-f-]+$/i.test(s)) return s.slice(0, 8) + "...";
  return s;
}

// --- Motion timing constants (mirror CSS tokens in globals.css) ---
// Use these when you need the duration in JS (framer-motion etc.) so the
// JS-driven and CSS-driven animations stay synchronized.
export const motionEase = {
  out: [0.25, 0.8, 0.5, 1] as const,
  spring: [0.34, 1.56, 0.64, 1] as const,
};

export const motionDuration = {
  fast: 0.12,
  base: 0.18,
  slow: 0.26,
} as const;

// --- Agent state derivation ---

/**
 * Derive a top-level status for an agent based on its session counts.
 * Matches the semantics the dashboard shows in the status badge.
 */
export function deriveAgentStatus(agent: AgentStatus): UiStatus {
  if (agent.activeSessions > 0) return "active";
  if (agent.suspendedSessions > 0) return "suspended";
  if (agent.idleSessions > 0) return "idle";
  return "idle";
}

/** First-letter avatar for an agent role. Null-safe. */
export function agentInitial(role: string | null | undefined): string {
  if (!role) return "?";
  return role.charAt(0).toUpperCase();
}

/** Returns the active session with the highest uptime, or null. */
export function primaryActiveSession(agent: AgentStatus) {
  const active = agent.sessions.filter((s) => s.state === "active");
  if (active.length === 0) return null;
  return active.reduce((best, s) => {
    if (!best) return s;
    if ((s.uptime ?? 0) > (best.uptime ?? 0)) return s;
    return best;
  }, active[0]);
}

// --- Time formatting ---

/** Format uptime in seconds as "1h 5m" or "42s". Returns "--" for null/0. */
export function formatUptime(seconds: number | null | undefined): string {
  if (seconds == null) return "--";
  if (seconds === 0) return "--";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

/** Format a duration between two unix ms timestamps. */
export function formatDurationMs(fromMs: number, toMs: number = Date.now()): string {
  const seconds = Math.max(0, Math.round((toMs - fromMs) / 1000));
  return formatUptime(seconds);
}

/** Format unix ms uptime (now - since) */
export function formatUptimeFrom(sinceMs: number): string {
  return formatDurationMs(sinceMs);
}

/**
 * Parse an event timestamp from either an ISO string or a SQLite
 * "YYYY-MM-DD HH:MM:SS" UTC datetime.
 */
export function parseEventTimestamp(input: string | null | undefined): number {
  if (!input) return Date.now();
  // Already ISO? Date can handle it directly.
  if (input.includes("T")) return new Date(input).getTime();
  // SQLite stores in UTC without a timezone — add Z so Date parses it as UTC.
  return new Date(input.replace(" ", "T") + "Z").getTime();
}

/** Relative time, relative to real Date.now() — no hardcoded "now". */
export function formatRelativeTime(timestamp: string | number | null | undefined): string {
  if (timestamp == null) return "just now";
  const thenMs =
    typeof timestamp === "number" ? timestamp : parseEventTimestamp(timestamp);
  const diffMs = Date.now() - thenMs;

  // Future timestamp (clock skew) — just show "just now".
  if (diffMs < 0) return "just now";

  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 30) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 1) return `${diffSec}s ago`;
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 30) return `${diffD}d ago`;
  const diffMo = Math.floor(diffD / 30);
  return `${diffMo}mo ago`;
}

/** Short absolute timestamp. */
export function formatTimestamp(timestamp: string | number): string {
  const ms =
    typeof timestamp === "number" ? timestamp : parseEventTimestamp(timestamp);
  return new Date(ms).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// --- Priority ---

/** Map numeric priority (routing/queue.ts) to a label. */
export function priorityLabel(priority: number): string {
  switch (priority) {
    case 1:
      return "CEO";
    case 2:
      return "Urgent";
    case 3:
      return "Normal";
    case 5:
      return "Duty";
    default:
      return `P${priority}`;
  }
}

/** Map numeric priority to a dot color class. */
export function priorityColor(priority: number): string {
  switch (priority) {
    case 1:
      return "bg-red-500";
    case 2:
      return "bg-orange-500";
    case 3:
      return "bg-yellow-500";
    case 5:
      return "bg-blue-500";
    default:
      return "bg-gray-500";
  }
}

// --- Session state → UiStatus mapping for TaskCard etc. ---

export function sessionStateToUiStatus(state: SessionState): UiStatus {
  return state;
}
