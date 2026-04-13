"use client";

import { useState } from "react";
import type { TaskHandoff } from "@/lib/types";
import { cn } from "@/lib/utils";
import { roleTextClass } from "./role-colors";

interface HandoffRendererProps {
  handoff: TaskHandoff;
}

/** Tiny markdown: headings, bold, code, line breaks. */
function renderMarkdown(text: string): React.ReactNode {
  const safe = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const html = safe
    .replace(/^### (.+)$/gm, '<h4 class="mt-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">$1</h4>')
    .replace(/^## (.+)$/gm, '<h3 class="mt-3 text-[13px] font-semibold">$1</h3>')
    .replace(/^# (.+)$/gm, '<h2 class="mt-3 text-sm font-semibold">$1</h2>')
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, '<code class="rounded bg-secondary px-1 py-0.5 font-mono text-[11px]">$1</code>')
    .replace(/\n/g, "<br />");
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}

export function HandoffRenderer({ handoff }: HandoffRendererProps) {
  const [expanded, setExpanded] = useState(false);
  const actions = handoff.actions;

  // Truncate body for collapsed view: show first ~2 lines
  const bodyPreview = handoff.body.split("\n").slice(0, 2).join("\n");
  const isLong = handoff.body.split("\n").length > 3 || handoff.body.length > 200;

  return (
    <div>
      <div className="mb-1.5 flex items-center gap-2">
        <h3 className="text-[9px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          Handoff
        </h3>
        {actions?.status && (
          <span className="text-[9px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
            · {actions.status}
          </span>
        )}
      </div>

      {actions && (
        <div className="mb-2 space-y-1 text-xs">
          {actions.delegate && (
            <div>
              <span className="text-muted-foreground">Delegate: </span>
              <span
                className={cn(
                  "font-mono font-semibold",
                  roleTextClass(actions.delegate),
                )}
              >
                {actions.delegate}
              </span>
            </div>
          )}
          {actions.parentStatus && (
            <div>
              <span className="text-muted-foreground">Parent: </span>
              <span className="font-mono">{actions.parentStatus}</span>
            </div>
          )}
          {actions.dispatches && actions.dispatches.length > 0 && (
            <div>
              <span className="text-muted-foreground">Dispatches:</span>
              <ul className="mt-1 space-y-0.5">
                {actions.dispatches.map((d, i) => (
                  <li
                    key={i}
                    className="ml-3 flex items-baseline gap-2 text-[11px]"
                  >
                    <span className="text-muted-foreground">↗</span>
                    <span
                      className={cn("font-mono font-semibold", roleTextClass(d.role))}
                    >
                      {d.role}
                    </span>
                    <span className="truncate text-muted-foreground">
                      {d.context}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <div className="max-w-none text-[13px] leading-relaxed text-foreground/90">
        {expanded || !isLong ? (
          renderMarkdown(handoff.body)
        ) : (
          <>
            {renderMarkdown(bodyPreview + "…")}
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="mt-1 text-[11px] font-medium text-primary hover:underline"
            >
              Show full handoff
            </button>
          </>
        )}
        {expanded && isLong && (
          <button
            type="button"
            onClick={() => setExpanded(false)}
            className="mt-1 text-[11px] font-medium text-primary hover:underline"
          >
            Collapse
          </button>
        )}
      </div>
    </div>
  );
}
