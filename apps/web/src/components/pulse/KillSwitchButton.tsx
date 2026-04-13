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
import {
  killSwitchPauseRaw,
  killSwitchResumeRaw,
  killSwitchStatus,
  PulseError,
} from "@/components/pulse/pulse-client";

interface KillSwitchButtonProps {
  paused: boolean;
  activeSessionsHint?: number;
  onChange?: () => void | Promise<void>;
}

export function KillSwitchButton({
  paused,
  activeSessionsHint = 0,
  onChange,
}: KillSwitchButtonProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const openConfirm = async () => {
    // Always re-read live status so the dialog reflects truth.
    try {
      await killSwitchStatus();
    } catch {
      /* fall through — confirm still useful */
    }
    setOpen(true);
  };

  const handleConfirm = async () => {
    setBusy(true);
    try {
      if (paused) {
        const res = await killSwitchResumeRaw();
        toast.success(
          res.wasPaused ? "Queue resumed" : "Queue was already running",
        );
      } else {
        const res = await killSwitchPauseRaw();
        toast.success(
          `Kill switch engaged · suspended ${res.suspended} session${
            res.suspended === 1 ? "" : "s"
          }${res.failed > 0 ? ` (${res.failed} failed)` : ""}`,
        );
      }
      setOpen(false);
      await onChange?.();
    } catch (err) {
      toast.error(
        err instanceof PulseError
          ? `Kill switch failed — ${err.message}`
          : "Kill switch failed",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        onClick={openConfirm}
        className={
          paused
            ? "inline-flex items-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-[12px] font-medium text-emerald-300 shadow-sm transition-colors hover:bg-emerald-500/20"
            : "inline-flex items-center gap-1.5 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-[12px] font-medium text-red-400 shadow-sm transition-colors hover:bg-red-500/20 hover:text-red-300"
        }
      >
        <span
          className={`h-1.5 w-1.5 rounded-full ${paused ? "bg-emerald-400" : "bg-red-500"}`}
        />
        {paused ? "Resume queue" : "Kill switch"}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {paused ? "Resume the queue?" : "Pause everything?"}
            </DialogTitle>
            <DialogDescription>
              {paused
                ? "This will release the global pause. New dispatches and resume hooks will start firing immediately."
                : `This will suspend ${
                    activeSessionsHint > 0
                      ? `${activeSessionsHint} active session${
                          activeSessionsHint === 1 ? "" : "s"
                        }`
                      : "all active sessions"
                  } and block new dispatches. You can resume at any time.`}
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
              variant={paused ? "default" : "destructive"}
              size="sm"
              onClick={handleConfirm}
              disabled={busy}
            >
              {busy
                ? paused
                  ? "Resuming…"
                  : "Pausing…"
                : paused
                  ? "Resume queue"
                  : "Pause everything"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
