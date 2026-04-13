"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { useWebSocket } from "@/lib/use-websocket";
import { DailyBriefing } from "@/components/pulse/DailyBriefing";
import { NeedsInputQueue } from "@/components/pulse/NeedsInputQueue";
import { WinsFeed } from "@/components/pulse/WinsFeed";
import { OkrsCard } from "@/components/pulse/OkrsCard";
import { DecisionLogCard } from "@/components/pulse/DecisionLogCard";
import { SlowTasksCard } from "@/components/pulse/SlowTasksCard";
import { KillSwitchButton } from "@/components/pulse/KillSwitchButton";
import {
  killSwitchResumeRaw,
  killSwitchStatus,
} from "@/components/pulse/pulse-client";
import { toast } from "sonner";

export default function PulsePage() {
  const [activeSessions, setActiveSessions] = useState(0);
  const [now, setNow] = useState<string>("");
  const [paused, setPaused] = useState<boolean>(false);
  const [resuming, setResuming] = useState(false);

  // Tick counters for child cards to react to WS-driven refresh requests.
  const [needsInputTick, setNeedsInputTick] = useState(0);
  const [winsTick, setWinsTick] = useState(0);
  const [briefingTick, setBriefingTick] = useState(0);

  useEffect(() => {
    setNow(
      new Date().toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      }),
    );
  }, []);

  const refreshActiveSessions = useCallback(async () => {
    try {
      const rows = await api.agents.list();
      const total = rows.reduce((sum, r) => sum + r.activeSessions, 0);
      setActiveSessions(total);
    } catch {
      setActiveSessions(0);
    }
  }, []);

  const refreshKillSwitch = useCallback(async () => {
    try {
      const s = await killSwitchStatus();
      setPaused(s.paused);
    } catch {
      setPaused(false);
    }
  }, []);

  useEffect(() => {
    void refreshActiveSessions();
    void refreshKillSwitch();
  }, [refreshActiveSessions, refreshKillSwitch]);

  // --- Real-time WS fan-out: route events into the right card refresh tick.
  const handleMessage = useCallback((msg: { type: string }) => {
    switch (msg.type) {
      case "notification:created":
        setNeedsInputTick((t) => t + 1);
        break;
      case "task:completed":
        setWinsTick((t) => t + 1);
        setBriefingTick((t) => t + 1);
        break;
      case "task:failed":
      case "system:budget-alert":
        setBriefingTick((t) => t + 1);
        break;
      case "agent:spawned":
      case "agent:completed":
      case "agent:failed":
      case "agent:idle":
      case "agent:suspended":
      case "agent:resumed":
        void refreshActiveSessions();
        break;
      default:
        break;
    }
  }, [refreshActiveSessions]);

  const wsOptions = useMemo(() => ({ onMessage: handleMessage }), [handleMessage]);
  useWebSocket(wsOptions);

  const handleResume = async () => {
    setResuming(true);
    try {
      await killSwitchResumeRaw();
      toast.success("Queue resumed");
      setPaused(false);
      await refreshActiveSessions();
    } catch (err) {
      toast.error(`Could not resume: ${(err as Error).message}`);
    } finally {
      setResuming(false);
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {paused && (
        <div className="flex items-center justify-between gap-3 border-b border-red-500/30 bg-red-500/10 px-6 py-2 text-[12px] text-red-300">
          <span>
            <span className="font-semibold">Global pause active</span> ·{" "}
            {activeSessions} session{activeSessions === 1 ? "" : "s"} suspended ·
            new dispatches blocked
          </span>
          <button
            onClick={handleResume}
            disabled={resuming}
            className="rounded-md border border-red-500/40 bg-red-500/20 px-2.5 py-0.5 text-[11px] font-medium text-red-200 hover:bg-red-500/30 disabled:opacity-50"
          >
            {resuming ? "Resuming…" : "Resume queue"}
          </button>
        </div>
      )}

      <header className="flex items-center justify-between border-b border-border px-6 py-4">
        <div>
          <h1 className="text-[18px] font-semibold tracking-tight">Pulse</h1>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {now || "Today"} · the one-person company command center
          </p>
        </div>
        <KillSwitchButton
          paused={paused}
          activeSessionsHint={activeSessions}
          onChange={refreshKillSwitch}
        />
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto grid max-w-[1400px] grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            <DailyBriefing refreshTick={briefingTick} />
            <NeedsInputQueue refreshTick={needsInputTick} />
            <WinsFeed refreshTick={winsTick} />
          </div>

          <div className="space-y-6">
            <OkrsCard />
            <DecisionLogCard />
            <SlowTasksCard />
          </div>
        </div>
      </div>
    </div>
  );
}
