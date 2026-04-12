// Shared role → color mapping for the task detail page.

export const ROLE_AVATAR_COLORS: Record<string, string> = {
  engineer: "bg-blue-500/20 text-blue-400",
  strategist: "bg-purple-500/20 text-purple-400",
  ops: "bg-amber-500/20 text-amber-400",
  "ceo-office": "bg-red-500/20 text-red-400",
  ceo: "bg-red-500/20 text-red-400",
};

export const ROLE_TEXT_COLORS: Record<string, string> = {
  engineer: "text-blue-400",
  strategist: "text-purple-400",
  ops: "text-amber-400",
  "ceo-office": "text-red-400",
  ceo: "text-red-400",
};

export function roleAvatarClass(role: string): string {
  return ROLE_AVATAR_COLORS[role] ?? "bg-muted text-muted-foreground";
}

export function roleTextClass(role: string): string {
  return ROLE_TEXT_COLORS[role] ?? "text-muted-foreground";
}

export function taskStateClass(state: string): string {
  switch (state) {
    case "running":
      return "bg-status-active/10 text-status-active border-status-active/30";
    case "todo":
      return "bg-muted text-muted-foreground border-border";
    case "review":
      return "bg-blue-500/10 text-blue-400 border-blue-500/30";
    case "done":
      return "bg-status-completed/10 text-status-completed border-status-completed/30";
    case "failed":
      return "bg-status-failed/10 text-status-failed border-status-failed/30";
    case "canceled":
      return "bg-muted text-muted-foreground border-border";
    default:
      return "bg-muted text-muted-foreground border-border";
  }
}
