"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";

interface KillSwitchButtonProps {
  activeSessionsHint?: number;
}

export function KillSwitchButton({
  activeSessionsHint = 0,
}: KillSwitchButtonProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const handleConfirm = async () => {
    setBusy(true);
    try {
      const res = await api.pulse.killSwitchPause();
      if (res.backendWired) {
        toast.success(
          `Kill switch engaged · suspended ${res.suspended} session${
            res.suspended === 1 ? "" : "s"
          }`,
        );
      } else {
        toast.warning(
          "Kill switch backend not wired yet — parent will finish.",
        );
      }
      setOpen(false);
    } catch {
      toast.error("Could not engage kill switch");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-[12px] font-medium text-red-400 shadow-sm transition-colors hover:bg-red-500/20 hover:text-red-300"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
        Kill switch
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Pause everything?</DialogTitle>
            <DialogDescription>
              This will suspend{" "}
              {activeSessionsHint > 0
                ? `${activeSessionsHint} active session${
                    activeSessionsHint === 1 ? "" : "s"
                  }`
                : "all active sessions"}{" "}
              and stop the dispatch queue. You can resume at any time.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setOpen(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleConfirm}
              disabled={busy}
            >
              {busy ? "Pausing…" : "Pause everything"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
