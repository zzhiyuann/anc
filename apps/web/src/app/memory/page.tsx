import { api } from "@/lib/api";
import { mockAgentMemory } from "@/lib/mock-data";
import { agentInitial } from "@/lib/utils";

export const dynamic = "force-dynamic";

async function loadMemory(): Promise<{
  byRole: Record<string, string[]>;
  shared: string[];
  live: boolean;
}> {
  try {
    const agents = await api.agents.list();
    const entries = await Promise.all(
      agents.map(async (a) => {
        try {
          const mem = await api.agents.memory(a.role);
          return [a.role, mem.files] as const;
        } catch {
          return [a.role, [] as string[]] as const;
        }
      }),
    );
    const shared = await api.memory.shared().catch(() => [] as string[]);
    return {
      byRole: Object.fromEntries(entries),
      shared,
      live: true,
    };
  } catch {
    return { byRole: mockAgentMemory, shared: [], live: false };
  }
}

const avatarColors: Record<string, string> = {
  engineer: "bg-blue-500/20 text-blue-400",
  strategist: "bg-purple-500/20 text-purple-400",
  ops: "bg-amber-500/20 text-amber-400",
};

export default async function MemoryPage() {
  const { byRole, shared, live } = await loadMemory();
  const total =
    Object.values(byRole).reduce((sum, arr) => sum + arr.length, 0) +
    shared.length;

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">Memory</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {total} memory files across all agents
          {!live && " (mock data — backend offline)"}
        </p>
      </div>

      <div className="space-y-6">
        {Object.entries(byRole).map(([role, files]) => (
          <section key={role}>
            <div className="mb-2 flex items-center gap-2">
              <div
                className={`flex size-7 items-center justify-center rounded-lg text-xs font-semibold ${
                  avatarColors[role] ?? "bg-muted text-muted-foreground"
                }`}
              >
                {agentInitial(role)}
              </div>
              <h2 className="text-sm font-semibold capitalize">{role}</h2>
              <span className="text-xs text-muted-foreground">
                ({files.length})
              </span>
            </div>
            <div className="space-y-2">
              {files.map((filename) => (
                <div
                  key={`${role}-${filename}`}
                  className="flex items-center gap-3 rounded-lg border border-border bg-card p-3"
                >
                  <svg
                    className="size-4 text-muted-foreground"
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  >
                    <path d="M4 2h5l3 3v9H4V2z" />
                    <path d="M9 2v3h3" />
                  </svg>
                  <span className="font-mono text-sm">{filename}</span>
                </div>
              ))}
              {files.length === 0 && (
                <p className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                  No memory files.
                </p>
              )}
            </div>
          </section>
        ))}

        {shared.length > 0 && (
          <section>
            <div className="mb-2 flex items-center gap-2">
              <h2 className="text-sm font-semibold">Shared</h2>
              <span className="text-xs text-muted-foreground">
                ({shared.length})
              </span>
            </div>
            <div className="space-y-2">
              {shared.map((filename) => (
                <div
                  key={`shared-${filename}`}
                  className="flex items-center gap-3 rounded-lg border border-border bg-card p-3"
                >
                  <svg
                    className="size-4 text-muted-foreground"
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  >
                    <path d="M4 2h5l3 3v9H4V2z" />
                    <path d="M9 2v3h3" />
                  </svg>
                  <span className="font-mono text-sm">{filename}</span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
