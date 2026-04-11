"use client";

import { useRef, useEffect } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

interface TerminalOutputProps {
  lines: string[];
  className?: string;
  autoScroll?: boolean;
}

function classifyLine(line: string): string {
  if (line.startsWith("$") || line.startsWith(">")) return "line-prompt";
  if (line.startsWith("#") || line.startsWith("//")) return "line-comment";
  if (
    line.toLowerCase().includes("error") ||
    line.toLowerCase().includes("fail")
  )
    return "line-error";
  return "";
}

export function TerminalOutput({
  lines,
  className,
  autoScroll = true,
}: TerminalOutputProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (autoScroll) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [lines, autoScroll]);

  return (
    <ScrollArea
      className={cn(
        "rounded-lg border border-border bg-[oklch(0.07_0.005_260)] p-4",
        className
      )}
    >
      <div className="terminal-output">
        {lines.map((line, i) => (
          <div key={i} className={cn("min-h-[1.6em]", classifyLine(line))}>
            {line || "\u00A0"}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </ScrollArea>
  );
}
