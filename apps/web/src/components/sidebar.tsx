"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

interface SidebarProps {
  collapsed?: boolean;
  onToggle?: () => void;
  onOpenLegend?: () => void;
}

interface RowProps {
  href: string;
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  collapsed?: boolean;
  badge?: number | string;
  binding?: string;
  indent?: number;
}

function Row({ href, icon, label, active, collapsed, badge, binding, indent = 0 }: RowProps) {
  return (
    <Link
      href={href}
      title={collapsed ? label : undefined}
      className={cn(
        "group relative flex h-[26px] items-center gap-1.5 rounded-md pr-2 text-[12.5px] transition-colors duration-100",
        active
          ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium shadow-[inset_2px_0_0_0_var(--sidebar-primary)]"
          : "text-sidebar-foreground/70 hover:bg-sidebar-accent/40 hover:text-sidebar-foreground",
      )}
      style={{ paddingLeft: collapsed ? 8 : 8 + indent * 12 }}
    >
      <span className="flex size-[15px] shrink-0 items-center justify-center [&_svg]:size-[15px]">{icon}</span>
      {!collapsed && <span className="min-w-0 flex-1 truncate">{label}</span>}
      {!collapsed && typeof badge === "number" && badge > 0 && (
        <span className="rounded bg-sidebar-accent px-1.5 font-mono text-[10px] text-sidebar-foreground">
          {badge > 99 ? "99+" : badge}
        </span>
      )}
      {!collapsed && binding && (
        <span className="ml-1 hidden rounded border border-sidebar-border/60 bg-sidebar-accent/40 px-1 font-mono text-[9px] text-sidebar-foreground/60 group-hover:inline-block">
          {binding}
        </span>
      )}
    </Link>
  );
}

function SectionHeader({
  label,
  collapsed,
  action,
  onClick,
  expanded,
}: {
  label: string;
  collapsed?: boolean;
  action?: React.ReactNode;
  onClick?: () => void;
  expanded?: boolean;
}) {
  if (collapsed) {
    return <div className="my-2 mx-2 h-px bg-sidebar-border/40" />;
  }
  return (
    <div className="mt-2 flex h-5 items-center justify-between px-2 pr-1">
      <button
        type="button"
        onClick={onClick}
        className="flex items-center gap-1 text-[9px] font-semibold uppercase tracking-[0.08em] text-sidebar-foreground/45 hover:text-sidebar-foreground/75"
      >
        {onClick && (
          <ChevronIcon className={cn("size-3 transition-transform", expanded ? "rotate-90" : "")} />
        )}
        <span>{label}</span>
      </button>
      {action}
    </div>
  );
}

export function Sidebar({ collapsed = false, onToggle, onOpenLegend }: SidebarProps) {
  const pathname = usePathname();
  const [unread, setUnread] = useState(0);

  // Unread count for inbox badge
  useEffect(() => {
    let aborted = false;
    api.notifications
      .unreadCount()
      .then((c) => {
        if (!aborted) setUnread(c);
      })
      .catch(() => {});
    return () => {
      aborted = true;
    };
  }, [pathname]);

  // Keyboard: g then <key>
  useEffect(() => {
    let pendingG = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (!pendingG) {
        if (e.key === "g") {
          pendingG = true;
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => {
            pendingG = false;
          }, 800);
        }
        return;
      }

      pendingG = false;
      if (timer) clearTimeout(timer);
      const target: Record<string, string> = {
        i: "/inbox",
        t: "/tasks",
        p: "/projects",
        m: "/members",
      };
      const dest = target[e.key];
      if (dest) {
        e.preventDefault();
        window.location.href = dest;
      }
    };
    window.addEventListener("keydown", handler);
    return () => {
      window.removeEventListener("keydown", handler);
      if (timer) clearTimeout(timer);
    };
  }, []);

  const isActive = (href: string, exact = false) => {
    if (exact) return pathname === href;
    if (href === "/") return pathname === "/";
    return pathname === href || pathname.startsWith(href + "/");
  };

  return (
    <aside
      className={cn(
        "flex h-full flex-col border-r border-sidebar-border bg-sidebar transition-[width] duration-200",
        collapsed ? "w-14" : "w-60",
      )}
    >
      {/* Workspace label (single workspace, non-interactive) */}
      <div className="flex h-10 shrink-0 items-center gap-2 px-2 pt-1.5">
        <div
          className={cn(
            "flex h-7 w-full items-center gap-1.5 rounded-md px-1.5",
            collapsed && "justify-center px-0",
          )}
        >
          <span className="flex size-5 shrink-0 items-center justify-center rounded bg-primary text-[10px] font-bold text-primary-foreground">
            A
          </span>
          {!collapsed && (
            <span className="min-w-0 flex-1 truncate text-[11px] font-bold tracking-tight text-sidebar-foreground">
              ANC
            </span>
          )}
        </div>
      </div>

      {/* Scrollable nav */}
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-3">
        {/* Top items */}
        <Row
          href="/inbox"
          icon={<InboxIcon />}
          label="Inbox"
          active={isActive("/inbox")}
          collapsed={collapsed}
          badge={unread}
          binding="g i"
        />
        <Row
          href="/tasks?assignee=ceo"
          icon={<UserIcon />}
          label="My issues"
          collapsed={collapsed}
        />
        <Row
          href="/pulse"
          icon={<PulseIcon />}
          label="Dashboard"
          active={isActive("/pulse")}
          collapsed={collapsed}
        />
        <Row
          href="/tasks"
          icon={<TaskIcon />}
          label="Tasks"
          active={isActive("/tasks")}
          collapsed={collapsed}
          binding="g t"
        />
        <Row
          href="/projects"
          icon={<ProjectIcon />}
          label="Projects"
          active={isActive("/projects")}
          collapsed={collapsed}
          binding="g p"
        />
        <Row
          href="/members"
          icon={<MembersIcon />}
          label="Members"
          active={isActive("/members")}
          collapsed={collapsed}
          binding="g m"
        />
        <Row
          href="/settings"
          icon={<SettingsIcon />}
          label="Settings"
          active={isActive("/settings")}
          collapsed={collapsed}
        />
      </nav>

      {/* Bottom: collapse + help */}
      <div className="flex h-9 shrink-0 items-center justify-between border-t border-sidebar-border/60 px-2">
        <button
          type="button"
          onClick={onToggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="flex size-6 items-center justify-center rounded text-sidebar-foreground/50 transition-colors hover:bg-sidebar-accent/70 hover:text-sidebar-foreground"
        >
          <svg
            className={cn("size-3.5 transition-transform", collapsed && "rotate-180")}
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <path d="M10 4l-4 4 4 4" />
          </svg>
        </button>
        {!collapsed && onOpenLegend && (
          <button
            type="button"
            onClick={onOpenLegend}
            aria-label="Keyboard shortcuts"
            title="Keyboard shortcuts (?)"
            className="flex size-6 items-center justify-center rounded text-sidebar-foreground/50 transition-colors hover:bg-sidebar-accent/70 hover:text-sidebar-foreground"
          >
            <svg className="size-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="8" cy="8" r="6" />
              <path d="M6.5 6a1.5 1.5 0 1 1 2.2 1.3c-.5.3-.7.7-.7 1.2M8 11h.01" />
            </svg>
          </button>
        )}
      </div>
    </aside>
  );
}

// ---------- icons ----------

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M6 4l4 4-4 4" />
    </svg>
  );
}
function PlusIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M8 3v10M3 8h10" />
    </svg>
  );
}
function InboxIcon() {
  return (
    <svg className="size-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M2 9l2-5h8l2 5M2 9v3a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V9M2 9h3l1 2h4l1-2h3" />
    </svg>
  );
}
function ReviewIcon() {
  return (
    <svg className="size-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M3 3h10v8H7l-3 3v-3H3z" />
    </svg>
  );
}
function UserIcon() {
  return (
    <svg className="size-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="8" cy="6" r="2.5" />
      <path d="M3 13c0-2.5 2.2-4 5-4s5 1.5 5 4" />
    </svg>
  );
}
function PulseIcon() {
  return (
    <svg className="size-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M2 8h3l2-5 2 10 2-5h3" />
    </svg>
  );
}
function ProjectIcon() {
  return (
    <svg className="size-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M2 5a2 2 0 0 1 2-2h2.5l1.5 1.5H12a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5z" />
    </svg>
  );
}
function ViewsIcon() {
  return (
    <svg className="size-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M2 4h12M2 8h12M2 12h8" />
    </svg>
  );
}
function MembersIcon() {
  return (
    <svg className="size-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="6" cy="6" r="2.2" />
      <circle cx="11" cy="7" r="1.8" />
      <path d="M2 13c0-2.2 1.8-3.5 4-3.5s4 1.3 4 3.5M9 13c0-1.7 1.2-2.7 3-2.7s2 1 2 2.7" />
    </svg>
  );
}
function SettingsIcon() {
  return (
    <svg className="size-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="8" cy="8" r="2" />
      <path d="M8 2v2M8 12v2M2 8h2M12 8h2M3.8 3.8l1.4 1.4M10.8 10.8l1.4 1.4M3.8 12.2l1.4-1.4M10.8 5.2l1.4-1.4" />
    </svg>
  );
}
function AgentIcon() {
  return (
    <svg className="size-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="8" cy="5" r="3" />
      <path d="M3 14c0-2.8 2.2-5 5-5s5 2.2 5 5" />
    </svg>
  );
}
function StarIcon() {
  return (
    <svg className="size-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M8 2l1.8 3.8 4.2.6-3 3 .7 4.2L8 11.6 4.3 13.6 5 9.4l-3-3 4.2-.6z" />
    </svg>
  );
}
function TaskIcon() {
  return (
    <svg className="size-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="2" y="2" width="12" height="12" rx="2" />
      <path d="M5 8l2 2 4-4" />
    </svg>
  );
}
function InitiativeIcon() {
  return (
    <svg className="size-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M3 13L13 3M9 3h4v4" />
    </svg>
  );
}
function CycleIcon() {
  return (
    <svg className="size-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M13 8a5 5 0 1 1-1.5-3.5M13 3v3h-3" />
    </svg>
  );
}
