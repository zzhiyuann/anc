import { Separator } from "@/components/ui/separator";
import { mockHealth } from "@/lib/mock-data";

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${d}d ${h}h ${m}m`;
}

function formatBytes(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(0)} MB`;
}

export default function SettingsPage() {
  const health = mockHealth;

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          System configuration and health
        </p>
      </div>

      <div className="max-w-2xl space-y-6">
        {/* System Info */}
        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold">System Health</h2>
          <Separator className="my-3" />
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">Status</span>
              <p className="mt-0.5 font-medium capitalize text-status-active">
                {health.status}
              </p>
            </div>
            <div>
              <span className="text-muted-foreground">Version</span>
              <p className="mt-0.5 font-mono font-medium">{health.version}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Uptime</span>
              <p className="mt-0.5 font-mono font-medium">
                {formatUptime(health.uptime)}
              </p>
            </div>
            <div>
              <span className="text-muted-foreground">Memory</span>
              <p className="mt-0.5 font-mono font-medium">
                {formatBytes(health.memory.heapUsed)} /{" "}
                {formatBytes(health.memory.heapTotal)}
              </p>
            </div>
          </div>
        </div>

        {/* Connection */}
        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold">Connection</h2>
          <Separator className="my-3" />
          <div className="space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">API Endpoint</span>
              <span className="font-mono">localhost:3848</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">WebSocket</span>
              <span className="font-mono">ws://localhost:3848/ws</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Dashboard Port</span>
              <span className="font-mono">3000</span>
            </div>
          </div>
        </div>

        {/* Agent Configuration */}
        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold">Agent Configuration</h2>
          <Separator className="my-3" />
          <div className="space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Total Agents</span>
              <span className="font-mono">{health.agents.total}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Queue Pending</span>
              <span className="font-mono">{health.queue.pending}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Queue Running</span>
              <span className="font-mono">{health.queue.running}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
