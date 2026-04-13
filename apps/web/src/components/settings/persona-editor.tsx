"use client";

import { useEffect, useState } from "react";
import { api, type PersonaSuggestion } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface PersonaEditorProps {
  role: string;
}

const PLACEHOLDER = `# ${"<"}role${">"} persona

(no persona file found — type below to create one)
`;

export function PersonaEditor({ role }: PersonaEditorProps) {
  const [body, setBody] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<PersonaSuggestion[] | null>(null);
  const [suggestLive, setSuggestLive] = useState(true);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const text = await api.personas.read(role);
      if (cancelled) return;
      setBody(text ?? PLACEHOLDER.replace("<role>", role));
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [role]);

  async function handleSave() {
    setSaving(true);
    setStatus(null);
    const res = await api.personas.write(role, body);
    setSaving(false);
    setStatus(res ? "Saved." : "Backend not wired — changes kept locally.");
  }

  async function handleSuggest() {
    setStatus("Analyzing…");
    const { suggestions: list, live } = await api.personas.suggest(role);
    setSuggestions(list);
    setSuggestLive(live);
    setStatus(live ? null : "Showing mock suggestions (backend not wired).");
  }

  function dismiss(id: string) {
    setDismissed((prev) => new Set(prev).add(id));
  }

  return (
    <div className="space-y-3">
      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={24}
        spellCheck={false}
        className="min-h-[420px] w-full resize-y font-mono text-[12px] leading-relaxed"
        disabled={!loaded}
      />

      <div className="flex items-center justify-between">
        <div className="text-[11px] text-muted-foreground">
          {status ?? `${body.length} chars`}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleSuggest}>
            Suggest improvements
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving || !loaded}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>

      {suggestions && (
        <div className="space-y-2 border-t border-border pt-3">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Suggestions {suggestLive ? "" : "(mock)"}
          </div>
          {suggestions
            .filter((s) => !dismissed.has(s.id))
            .map((s) => (
              <div
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
                  <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] uppercase text-muted-foreground">
                    {s.kind}
                  </span>
                </div>
                <div className="mt-2 flex justify-end gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => dismiss(s.id)}
                  >
                    Reject
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => dismiss(s.id)}
                  >
                    Accept
                  </Button>
                </div>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
