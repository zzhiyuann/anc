"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { api, ApiError, type PersonaSuggestion } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

interface PersonaTabProps {
  role: string;
}

type Mode = "view" | "edit";

/**
 * Tiny markdown renderer — headings, lists, code, bold. Mirrors the helper in
 * HandoffRenderer.tsx but adds list and fenced-code support since persona
 * files are real markdown documents.
 */
function renderMarkdown(text: string): React.ReactNode {
  // Pull fenced code blocks out first, escape, then re-inject as <pre>.
  const blocks: string[] = [];
  const withPlaceholders = text.replace(/```([\s\S]*?)```/g, (_, code) => {
    const idx = blocks.push(code) - 1;
    return `\u0000FENCE${idx}\u0000`;
  });

  const escape = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const lines = withPlaceholders.split("\n");
  const out: string[] = [];
  let inList = false;
  const closeList = () => {
    if (inList) {
      out.push("</ul>");
      inList = false;
    }
  };

  for (const raw of lines) {
    const line = raw;
    const fenceMatch = line.match(/^\u0000FENCE(\d+)\u0000$/);
    if (fenceMatch) {
      closeList();
      const code = blocks[Number(fenceMatch[1])] ?? "";
      out.push(
        `<pre class="my-2 overflow-x-auto rounded-md border border-border bg-secondary/40 p-3 font-mono text-[12px] leading-relaxed">${escape(code).replace(/^\n/, "")}</pre>`,
      );
      continue;
    }
    if (/^\s*$/.test(line)) {
      closeList();
      out.push("");
      continue;
    }
    const h1 = line.match(/^# (.+)$/);
    const h2 = line.match(/^## (.+)$/);
    const h3 = line.match(/^### (.+)$/);
    const h4 = line.match(/^#### (.+)$/);
    const li = line.match(/^[-*] (.+)$/);
    if (h1) {
      closeList();
      out.push(
        `<h2 class="mt-4 mb-2 text-base font-semibold">${escape(h1[1])}</h2>`,
      );
      continue;
    }
    if (h2) {
      closeList();
      out.push(
        `<h3 class="mt-4 mb-2 text-sm font-semibold">${escape(h2[1])}</h3>`,
      );
      continue;
    }
    if (h3) {
      closeList();
      out.push(
        `<h4 class="mt-3 mb-1 text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">${escape(h3[1])}</h4>`,
      );
      continue;
    }
    if (h4) {
      closeList();
      out.push(
        `<h5 class="mt-3 mb-1 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">${escape(h4[1])}</h5>`,
      );
      continue;
    }
    if (li) {
      if (!inList) {
        out.push('<ul class="my-1 list-disc space-y-0.5 pl-5">');
        inList = true;
      }
      const item = escape(li[1])
        .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
        .replace(
          /`([^`]+)`/g,
          '<code class="rounded bg-secondary px-1 py-0.5 font-mono text-[12px]">$1</code>',
        );
      out.push(`<li>${item}</li>`);
      continue;
    }
    closeList();
    const para = escape(line)
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(
        /`([^`]+)`/g,
        '<code class="rounded bg-secondary px-1 py-0.5 font-mono text-[12px]">$1</code>',
      );
    out.push(`<p class="my-1.5">${para}</p>`);
  }
  closeList();

  return (
    <div
      className="text-[14px] leading-relaxed text-foreground/90"
      dangerouslySetInnerHTML={{ __html: out.join("\n") }}
    />
  );
}

export function PersonaTab({ role }: PersonaTabProps) {
  const [body, setBody] = useState<string>("");
  const [originalBody, setOriginalBody] = useState<string>("");
  const [mode, setMode] = useState<Mode>("view");
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showSuggest, setShowSuggest] = useState(false);
  const [suggestions, setSuggestions] = useState<PersonaSuggestion[] | null>(null);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const dirty = mode === "edit" && body !== originalBody;
  const filePath = `personas/roles/${role}.md`;

  const load = useCallback(async () => {
    setLoading(true);
    setMissing(false);
    try {
      const text = await api.personas.read(role);
      if (text == null) {
        setMissing(true);
        setBody("");
        setOriginalBody("");
      } else {
        setBody(text);
        setOriginalBody(text);
      }
    } catch (err) {
      toast.error(
        err instanceof ApiError
          ? `Failed to load persona: ${err.message}`
          : "Failed to load persona",
      );
    } finally {
      setLoading(false);
    }
  }, [role]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSave = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    try {
      const res = await api.personas.write(role, body);
      if (res == null) {
        toast.error("Persona endpoint not available");
        return;
      }
      setOriginalBody(body);
      setMode("view");
      toast.success("Persona saved");
    } catch (err) {
      toast.error(
        err instanceof ApiError
          ? `Save failed: ${err.message}`
          : "Save failed",
      );
    } finally {
      setSaving(false);
    }
  }, [body, role, saving]);

  const handleCancel = useCallback(() => {
    setBody(originalBody);
    setMode("view");
  }, [originalBody]);

  // Keyboard: Cmd/Ctrl+S to save, Esc to cancel — only in edit mode.
  useEffect(() => {
    if (mode !== "edit") return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void handleSave();
      } else if (e.key === "Escape") {
        e.preventDefault();
        handleCancel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, handleSave, handleCancel]);

  async function loadSuggestions() {
    if (suggestions != null || suggestLoading) return;
    setSuggestLoading(true);
    try {
      const res = await api.personas.suggest(role);
      setSuggestions(res.suggestions);
    } catch (err) {
      toast.error(
        err instanceof ApiError
          ? `Suggest failed: ${err.message}`
          : "Suggest failed",
      );
    } finally {
      setSuggestLoading(false);
    }
  }

  async function handleCreate() {
    const seed = `# ${role}\n\n(Describe this role's mandate, scope, and standards.)\n`;
    setSaving(true);
    try {
      const res = await api.personas.write(role, seed);
      if (res == null) {
        toast.error("Persona endpoint not available");
        return;
      }
      setBody(seed);
      setOriginalBody(seed);
      setMissing(false);
      setMode("edit");
      toast.success("Persona file created");
    } catch (err) {
      toast.error(
        err instanceof ApiError ? `Create failed: ${err.message}` : "Create failed",
      );
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 size-4 animate-spin" />
        Loading persona…
      </div>
    );
  }

  if (missing) {
    return (
      <div className="rounded-lg border border-dashed border-border p-10 text-center">
        <p className="text-sm text-muted-foreground">
          No persona file for{" "}
          <span className="font-mono text-foreground">{role}</span>.
        </p>
        <p className="mt-1 font-mono text-[11px] text-muted-foreground">
          {filePath}
        </p>
        <Button
          size="sm"
          className="mt-4"
          disabled={saving}
          onClick={handleCreate}
        >
          {saving ? "Creating…" : "Create persona file"}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header row */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold tracking-tight">
            Persona <span className="text-muted-foreground">·</span>{" "}
            <span className="font-mono">{role}</span>
          </h2>
          {dirty && (
            <span
              aria-label="Unsaved changes"
              className="size-1.5 rounded-full bg-amber-400"
            />
          )}
        </div>
        <div className="flex items-center gap-2">
          {mode === "view" ? (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setMode("view")}
                className="h-7"
                disabled
              >
                View raw
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  setMode("edit");
                  setTimeout(() => textareaRef.current?.focus(), 0);
                }}
                className="h-7"
              >
                Edit
              </Button>
            </>
          ) : (
            <>
              <Button
                size="sm"
                variant="ghost"
                onClick={handleCancel}
                className="h-7"
                disabled={saving}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleSave}
                className="h-7"
                disabled={saving || !dirty}
              >
                {saving ? "Saving…" : "Save"}
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Content area */}
      <div
        className={cn(
          "rounded-lg border border-border bg-card",
          mode === "edit" ? "p-0" : "p-5",
        )}
      >
        {mode === "view" ? (
          renderMarkdown(body)
        ) : (
          <Textarea
            ref={textareaRef}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            spellCheck={false}
            className="min-h-[480px] w-full resize-y rounded-lg border-0 bg-transparent font-mono text-[13px] leading-relaxed focus-visible:ring-0 focus-visible:ring-offset-0"
          />
        )}
      </div>

      {/* Footer metadata */}
      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span>
          File path: <span className="font-mono">{filePath}</span>
        </span>
        {mode === "edit" && (
          <span>
            <kbd className="rounded border border-border bg-secondary px-1 font-mono">
              ⌘S
            </kbd>{" "}
            save ·{" "}
            <kbd className="rounded border border-border bg-secondary px-1 font-mono">
              Esc
            </kbd>{" "}
            cancel
          </span>
        )}
      </div>

      {/* Scope health collapsible */}
      <div className="rounded-lg border border-border bg-card">
        <button
          type="button"
          className="flex w-full items-center justify-between px-4 py-2.5 text-left text-[13px] font-medium hover:bg-secondary/30"
          onClick={() => {
            const next = !showSuggest;
            setShowSuggest(next);
            if (next) void loadSuggestions();
          }}
        >
          <span className="flex items-center gap-2">
            {showSuggest ? (
              <ChevronDown className="size-4" />
            ) : (
              <ChevronRight className="size-4" />
            )}
            Scope health for this role
          </span>
          {suggestions && (
            <span className="text-[11px] text-muted-foreground">
              {suggestions.length} {suggestions.length === 1 ? "note" : "notes"}
            </span>
          )}
        </button>
        {showSuggest && (
          <div className="border-t border-border p-3">
            {suggestLoading && (
              <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
                <Loader2 className="size-3 animate-spin" />
                Analyzing…
              </div>
            )}
            {!suggestLoading && suggestions && suggestions.length === 0 && (
              <p className="px-1 text-[12px] text-muted-foreground">
                No scope issues detected.
              </p>
            )}
            {!suggestLoading && suggestions && suggestions.length > 0 && (
              <ul className="space-y-2">
                {suggestions.map((s) => (
                  <li
                    key={s.id}
                    className="rounded-md border border-border bg-secondary/30 p-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-[13px] font-medium">{s.title}</div>
                        <div className="mt-1 text-[12px] text-muted-foreground">
                          {s.rationale}
                        </div>
                      </div>
                      <span className="shrink-0 rounded-full bg-secondary px-2 py-0.5 text-[10px] uppercase text-muted-foreground">
                        {s.kind}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
