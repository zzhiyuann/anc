import { ScrollArea } from "@/components/ui/scroll-area";
import { mockAgentDetails } from "@/lib/mock-data";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function formatTimestamp(ts: string): string {
  return new Date(ts).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function MemoryPage() {
  const allMemories = Object.entries(mockAgentDetails).flatMap(([role, agent]) =>
    agent.memoryEntries.map((entry) => ({ ...entry, agent: role, agentName: agent.name }))
  );

  allMemories.sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );

  const avatarColors: Record<string, string> = {
    engineer: "bg-blue-500/20 text-blue-400",
    strategist: "bg-purple-500/20 text-purple-400",
    ops: "bg-amber-500/20 text-amber-400",
  };

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">Memory</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {allMemories.length} memory files across all agents
        </p>
      </div>

      <div className="space-y-3">
        {allMemories.map((entry) => (
          <div
            key={`${entry.agent}-${entry.filename}`}
            className="rounded-lg border border-border bg-card p-4"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div
                  className={`flex size-7 items-center justify-center rounded-lg text-xs font-semibold ${avatarColors[entry.agent] ?? "bg-muted text-muted-foreground"}`}
                >
                  {entry.agent.charAt(0).toUpperCase()}
                </div>
                <div>
                  <span className="font-mono text-sm font-medium">
                    {entry.filename}
                  </span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {entry.agentName}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span>{formatBytes(entry.sizeBytes)}</span>
                <span>{formatTimestamp(entry.updatedAt)}</span>
              </div>
            </div>
            <ScrollArea className="mt-3 max-h-32">
              <pre className="font-mono text-xs leading-relaxed text-muted-foreground">
                {entry.content}
              </pre>
            </ScrollArea>
          </div>
        ))}
      </div>
    </div>
  );
}
