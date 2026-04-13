"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { NotificationBell } from "./inbox/notification-bell";
import { ThemeToggle } from "./theme-toggle";
import { tasks as tasksApi } from "@/lib/api";
import type { WsMessage } from "@/lib/types";

interface HeaderProps {
  connected: boolean;
  onCommandPalette: () => void;
  onToggleSidebar?: () => void;
  lastMessage?: WsMessage | null;
}

interface Crumb {
  label: string;
  href?: string;
}

/** UUIDv4 / cuid-ish — anything longer than 16 chars with dashes. */
function looksLikeId(seg: string): boolean {
  return seg.length > 16 || /^[0-9a-f-]{8,}$/i.test(seg);
}

function buildCrumbs(pathname: string, taskTitleOverride: string | null): Crumb[] {
  if (!pathname || pathname === "/") return [{ label: "Dashboard" }];
  const parts = pathname.split("/").filter(Boolean);
  const crumbs: Crumb[] = [];
  let acc = "";
  for (let i = 0; i < parts.length; i++) {
    const seg = parts[i];
    acc += "/" + seg;
    const isLast = i === parts.length - 1;
    let label: string;
    if (i === 0) {
      label = seg.charAt(0).toUpperCase() + seg.slice(1);
    } else if (looksLikeId(seg) && taskTitleOverride) {
      label = taskTitleOverride;
    } else if (seg.length > 28) {
      label = seg.slice(0, 26) + "…";
    } else {
      label = seg;
    }
    crumbs.push({ label, href: isLast ? undefined : acc });
  }
  return crumbs;
}

export function Header({
  connected,
  onCommandPalette,
  onToggleSidebar,
  lastMessage,
}: HeaderProps) {
  const pathname = usePathname() || "/";
  const searchParams = useSearchParams();
  const searchRef = useRef<HTMLInputElement>(null);
  const [taskTitle, setTaskTitle] = useState<string | null>(null);

  // Resolve a task title for the breadcrumb when we're on /tasks/[id] or
  // /tasks?task=<id>. Falls back silently if the lookup fails.
  const taskIdForCrumb = useMemo(() => {
    if (pathname.startsWith("/tasks/")) {
      const rest = pathname.slice("/tasks/".length).split("/")[0];
      return rest || null;
    }
    if (pathname === "/tasks") {
      return searchParams?.get("task") ?? null;
    }
    return null;
  }, [pathname, searchParams]);

  useEffect(() => {
    if (!taskIdForCrumb) {
      setTaskTitle(null);
      return;
    }
    let aborted = false;
    tasksApi
      .getFull(taskIdForCrumb)
      .then((full) => {
        if (!aborted) setTaskTitle(full.task?.title ?? null);
      })
      .catch(() => {
        if (!aborted) setTaskTitle(null);
      });
    return () => {
      aborted = true;
    };
  }, [taskIdForCrumb]);

  const crumbs = useMemo(() => {
    const base = buildCrumbs(pathname, taskTitle);
    // When a task is selected via query param (/tasks?task=<id>), append the
    // resolved title (or a short ID fallback) so the breadcrumb reads
    // "Tasks / Fix auth bug" instead of just "Tasks".
    if (pathname === "/tasks" && taskIdForCrumb && base.length === 1) {
      // Make the "Tasks" crumb a link
      base[0].href = "/tasks";
      const label = taskTitle ?? taskIdForCrumb.replace(/^task-/, "").slice(0, 8);
      base.push({ label });
    }
    return base;
  }, [pathname, taskTitle, taskIdForCrumb]);

  // `/` focuses search box
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/") return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if ((e.target as HTMLElement | null)?.isContentEditable) return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-background/80 px-4 backdrop-blur-sm">
      {/* Left: sidebar toggle + breadcrumb */}
      <div className="flex min-w-0 items-center gap-2">
        {onToggleSidebar && (
          <button
            type="button"
            onClick={onToggleSidebar}
            aria-label="Toggle sidebar"
            title="Toggle sidebar (⌘\\)"
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <svg className="size-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="2" y="3" width="12" height="10" rx="1.5" />
              <path d="M6 3v10" />
            </svg>
          </button>
        )}
        <nav className="flex min-w-0 items-center gap-1.5 text-[13px] text-foreground/70">
          {crumbs.map((c, i) => (
            <span key={i} className="flex min-w-0 items-center gap-1.5">
              {i > 0 && (
                <span className="text-muted-foreground/40" aria-hidden>
                  /
                </span>
              )}
              {c.href ? (
                <Link
                  href={c.href}
                  className="truncate font-mono text-foreground/70 hover:text-foreground"
                >
                  {c.label}
                </Link>
              ) : (
                <span className="truncate font-medium text-foreground">{c.label}</span>
              )}
            </span>
          ))}
        </nav>
      </div>

      {/* Center: search box */}
      <div className="hidden min-w-0 flex-1 justify-center px-6 md:flex">
        <div className="relative w-full max-w-sm">
          <svg
            className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <circle cx="7" cy="7" r="4" />
            <path d="M10 10l3 3" />
          </svg>
          <input
            ref={searchRef}
            type="text"
            placeholder="Search…"
            onFocus={() => onCommandPalette()}
            className="h-7 w-full rounded-md border border-border bg-secondary/40 pl-8 pr-12 text-[12px] text-foreground placeholder:text-muted-foreground focus:bg-background focus:outline-none focus:ring-1 focus:ring-primary/40"
          />
          <kbd className="absolute right-2 top-1/2 -translate-y-1/2 rounded border border-border bg-background px-1 py-0 font-mono text-[9px] text-muted-foreground">
            /
          </kbd>
        </div>
      </div>

      {/* Right */}
      <div className="flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          onClick={onCommandPalette}
          aria-label="Open command palette"
          title="Search (⌘K)"
          className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground md:hidden"
        >
          <svg className="size-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="7" cy="7" r="4" />
            <path d="M10 10l3 3" />
          </svg>
        </button>
        <ThemeToggle />
        <NotificationBell lastMessage={lastMessage} />
        <div
          className={cn(
            "flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px]",
            connected
              ? "bg-status-active/10 text-status-active"
              : "bg-status-failed/10 text-status-failed",
          )}
          title={connected ? "Connected" : "Disconnected"}
        >
          <span
            className={cn(
              "size-1.5 rounded-full",
              connected ? "bg-status-active" : "bg-status-failed",
            )}
          />
          <span className="hidden sm:inline">{connected ? "Connected" : "Disconnected"}</span>
        </div>
      </div>
    </header>
  );
}
