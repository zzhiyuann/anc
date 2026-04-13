"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { DailyBriefing } from "@/components/pulse/DailyBriefing";
import { NeedsInputQueue } from "@/components/pulse/NeedsInputQueue";
import { WinsFeed } from "@/components/pulse/WinsFeed";
import { OkrsCard } from "@/components/pulse/OkrsCard";
import { DecisionLogCard } from "@/components/pulse/DecisionLogCard";
import { SlowTasksCard } from "@/components/pulse/SlowTasksCard";
import { KillSwitchButton } from "@/components/pulse/KillSwitchButton";

export default function PulsePage() {
  const [activeSessions, setActiveSessions] = useState(0);
  const [now, setNow] = useState<string>("");

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

  useEffect(() => {
    let aborted = false;
    api.agents
      .list()
      .then((rows) => {
        if (aborted) return;
        const total = rows.reduce((sum, r) => sum + r.activeSessions, 0);
        setActiveSessions(total);
      })
      .catch(() => {
        if (!aborted) setActiveSessions(0);
      });
    return () => {
      aborted = true;
    };
  }, []);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex items-center justify-between border-b border-border px-6 py-4">
        <div>
          <h1 className="text-[18px] font-semibold tracking-tight">Pulse</h1>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {now || "Today"} · the one-person company command center
          </p>
        </div>
        <KillSwitchButton activeSessionsHint={activeSessions} />
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto grid max-w-[1400px] grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            <DailyBriefing />
            <NeedsInputQueue />
            <WinsFeed />
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
