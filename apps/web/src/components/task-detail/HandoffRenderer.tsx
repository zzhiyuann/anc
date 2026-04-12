"use client";

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
    .replace(/^### (.+)$/gm, '<h4 class="mt-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">$1</h4>')
    .replace(/^## (.+)$/gm, '<h3 class="mt-4 text-sm font-semibold">$1</h3>')
    .replace(/^# (.+)$/gm, '<h2 class="mt-4 text-base font-semibold">$1</h2>')
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, '<code class="rounded bg-secondary px-1 py-0.5 font-mono text-[11px]">$1</code>')
    .replace(/\n/g, "<br />");
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}

export function HandoffRenderer({ handoff }: HandoffRendererProps) {
  const actions = handoff.actions;

  return (
    <div className="rounded-lg border border-blue-500/30 bg-blue-500/[0.04] p-4">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-base">📄</span>
        <h3 className="text-sm font-semibold">Handoff</h3>
        {actions?.status && (
          <span className="ml-auto rounded-md bg-blue-500/20 px-2 py-0.5 text-[10px] font-medium uppercase text-blue-300">
            {actions.status}
          </span>
        )}
      </div>

      {actions && (
        <div className="mb-3 space-y-1.5 text-xs">
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
              <ul className="mt-1 space-y-1">
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

      <div className="prose prose-invert max-w-none text-sm leading-relaxed text-foreground/90">
        {renderMarkdown(handoff.body)}
      </div>
    </div>
  );
}
