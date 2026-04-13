"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { Button } from "@/components/ui/button";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { roleAvatarClass } from "@/components/task-detail/role-colors";
import type { AgentStatus, TaskComment } from "@/lib/types";

interface MentionComposerProps {
  taskId: string;
  onPosted: (comment: TaskComment) => void;
  placeholder?: string;
  /** Visible author label for the placeholder/help text. */
  authorLabel?: string;
}

interface Token {
  type: "text" | "mention";
  value: string;
}

const FALLBACK_ROSTER = ["engineer", "strategist", "ops"];

function tokensToBody(tokens: Token[]): string {
  return tokens
    .map((t) => (t.type === "mention" ? `@${t.value}` : t.value))
    .join("");
}

function tokensToMentions(tokens: Token[]): string[] {
  const seen = new Set<string>();
  for (const t of tokens) {
    if (t.type === "mention") seen.add(t.value);
  }
  return [...seen];
}

export function MentionComposer({
  taskId,
  onPosted,
  placeholder = "Leave a comment… (@ to mention, ⌘Enter to send)",
  authorLabel = "CEO",
}: MentionComposerProps) {
  const [tokens, setTokens] = useState<Token[]>([{ type: "text", value: "" }]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // @-mention state
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuQuery, setMenuQuery] = useState("");
  const [menuIndex, setMenuIndex] = useState(0);
  const [roster, setRoster] = useState<string[]>(FALLBACK_ROSTER);

  const taRef = useRef<HTMLTextAreaElement>(null);

  // Last token must always be a free text token where the user types.
  const tail = tokens[tokens.length - 1];
  const tailText = tail.type === "text" ? tail.value : "";

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list: AgentStatus[] = await api.agents.list();
        if (cancelled) return;
        const roles = list.map((a) => a.role).filter(Boolean);
        if (roles.length > 0) setRoster(roles);
      } catch {
        /* keep fallback */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const personnel = useMemo(() => ["ceo", ...roster.filter((r) => r !== "ceo")], [roster]);

  const filtered = useMemo(() => {
    const q = menuQuery.toLowerCase();
    const list = personnel.filter((p) => p.toLowerCase().includes(q));
    // Always pin CEO first if it matches.
    return list;
  }, [personnel, menuQuery]);

  const updateTail = (next: string) => {
    const copy = tokens.slice();
    copy[copy.length - 1] = { type: "text", value: next };
    setTokens(copy);
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value;
    updateTail(v);
    // Detect @-trigger: last "@" with no whitespace after.
    const match = /(?:^|[\s])@([\w-]*)$/.exec(v);
    if (match) {
      setMenuOpen(true);
      setMenuQuery(match[1] ?? "");
      setMenuIndex(0);
    } else if (v.endsWith("@")) {
      setMenuOpen(true);
      setMenuQuery("");
      setMenuIndex(0);
    } else {
      setMenuOpen(false);
    }
  };

  const insertMention = useCallback(
    (role: string) => {
      // Remove the trailing "@query" from the tail and append a mention chip + new empty text.
      const trimmed = tailText.replace(/@([\w-]*)$/, "");
      const next: Token[] = [...tokens.slice(0, -1)];
      next.push({ type: "text", value: trimmed });
      next.push({ type: "mention", value: role });
      next.push({ type: "text", value: " " });
      setTokens(next);
      setMenuOpen(false);
      setMenuQuery("");
      // Refocus.
      requestAnimationFrame(() => taRef.current?.focus());
    },
    [tokens, tailText],
  );

  const removeLastMentionIfBackspace = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // If cursor is at start of tail text and previous token is a mention, remove it.
    if (e.key !== "Backspace") return;
    if (tailText.length !== 0) return;
    if (tokens.length < 2) return;
    const prev = tokens[tokens.length - 2];
    if (prev.type !== "mention") return;
    e.preventDefault();
    const next = tokens.slice(0, -2);
    next.push({ type: "text", value: "" });
    setTokens(next);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (menuOpen && filtered.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMenuIndex((i) => (i + 1) % filtered.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMenuIndex((i) => (i - 1 + filtered.length) % filtered.length);
        return;
      }
      if (e.key === "Enter" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        insertMention(filtered[menuIndex]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMenuOpen(false);
        return;
      }
    }
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      void submit();
      return;
    }
    removeLastMentionIfBackspace(e);
  };

  const submit = async () => {
    const body = tokensToBody(tokens).trim();
    if (!body) return;
    const mentions = tokensToMentions(tokens);
    setSubmitting(true);
    setError(null);
    try {
      const comment = await api.taskComments.create(taskId, body, { mentions });
      onPosted(comment);
      setTokens([{ type: "text", value: "" }]);
    } catch (err) {
      if (err instanceof ApiError && (err.status === 404 || err.status === 0)) {
        const local: TaskComment = {
          id: -Date.now(),
          taskId,
          author: "ceo",
          body,
          parentId: null,
          createdAt: Date.now(),
        };
        onPosted(local);
        setTokens([{ type: "text", value: "" }]);
      } else {
        setError(err instanceof ApiError ? err.message : "Failed to post");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const hasContent = tokensToBody(tokens).trim().length > 0;

  return (
    <div className="rounded-lg border border-border bg-card">
      {/* Chip preview row — only if mentions exist */}
      {tokens.some((t) => t.type === "mention") && (
        <div className="flex flex-wrap items-center gap-1 border-b border-border px-3 py-2">
          {tokens.map((t, i) =>
            t.type === "mention" ? (
              <span
                key={`${i}-${t.value}`}
                className="inline-flex items-center gap-1 rounded-full border border-border bg-accent px-1.5 py-0.5 text-[11px]"
              >
                <span
                  className={cn(
                    "size-1.5 rounded-full",
                    roleAvatarClass(t.value).split(" ")[0]?.replace("bg-", "bg-") ?? "bg-muted",
                  )}
                />
                <span className="font-medium">@{t.value}</span>
              </span>
            ) : null,
          )}
        </div>
      )}

      <div className="relative">
        <textarea
          ref={taRef}
          value={tailText}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={3}
          disabled={submitting}
          className="block w-full resize-none bg-transparent px-3 py-2.5 text-[13px] leading-relaxed text-foreground placeholder:text-muted-foreground/70 focus:outline-none"
        />

        {menuOpen && filtered.length > 0 && (
          <div className="absolute bottom-full left-3 mb-1 w-56 overflow-hidden rounded-md border border-border bg-popover shadow-lg">
            <div className="border-b border-border px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              People
            </div>
            <ul className="max-h-56 overflow-y-auto py-1">
              {filtered.map((p, i) => (
                <li key={p}>
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      insertMention(p);
                    }}
                    onMouseEnter={() => setMenuIndex(i)}
                    className={cn(
                      "flex w-full items-center gap-2 px-2 py-1 text-left text-[13px]",
                      i === menuIndex
                        ? "bg-accent text-accent-foreground"
                        : "text-foreground",
                    )}
                  >
                    <span
                      className={cn(
                        "flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold",
                        roleAvatarClass(p),
                      )}
                      aria-hidden
                    >
                      {p.charAt(0).toUpperCase()}
                    </span>
                    <span className="truncate capitalize">{p}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between border-t border-border px-3 py-1.5">
        <span
          className={cn(
            "text-[11px]",
            error ? "text-status-failed" : "text-muted-foreground",
          )}
        >
          {error ?? `${authorLabel} · @ to mention · ⌘Enter to send`}
        </span>
        <Button size="sm" onClick={submit} disabled={submitting || !hasContent}>
          {submitting ? "Posting…" : "Comment"}
        </Button>
      </div>
    </div>
  );
}
