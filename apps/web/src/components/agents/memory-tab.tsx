"use client";

/**
 * MemoryTab — full CRUD for memory files in `~/.anc/agents/<role>/memory/`.
 *
 * Endpoints:
 *   GET    /agents/:role/memory            → { role, files: string[] }
 *   GET    /agents/:role/memory/:filename  → { filename, body, mtime }
 *   PUT    /agents/:role/memory/:filename  → { ok }
 *   DELETE /agents/:role/memory/:filename  → { ok }
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { FileText, Loader2, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

interface MemoryTabProps {
  role: string;
  initialFiles: string[];
}

type Mode = "list" | "view" | "edit" | "create";

/**
 * Minimal markdown renderer (headings, lists, code, bold) matching PersonaTab.
 */
function renderMarkdown(text: string): React.ReactNode {
  const blocks: string[] = [];
  const withPlaceholders = text.replace(/```([\s\S]*?)```/g, (_, code) => {
    const idx = blocks.push(code as string) - 1;
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
    const fenceMatch = raw.match(/^\u0000FENCE(\d+)\u0000$/);
    if (fenceMatch) {
      closeList();
      const code = blocks[Number(fenceMatch[1])] ?? "";
      out.push(
        `<pre class="my-2 overflow-x-auto rounded-md border border-border bg-secondary/40 p-3 font-mono text-[12px] leading-relaxed">${escape(code).replace(/^\n/, "")}</pre>`,
      );
      continue;
    }
    if (/^\s*$/.test(raw)) {
      closeList();
      out.push("");
      continue;
    }
    const h1 = raw.match(/^# (.+)$/);
    const h2 = raw.match(/^## (.+)$/);
    const h3 = raw.match(/^### (.+)$/);
    const li = raw.match(/^[-*] (.+)$/);
    if (h1) {
      closeList();
      out.push(`<h2 class="mt-4 mb-2 text-base font-semibold">${escape(h1[1])}</h2>`);
      continue;
    }
    if (h2) {
      closeList();
      out.push(`<h3 class="mt-4 mb-2 text-sm font-semibold">${escape(h2[1])}</h3>`);
      continue;
    }
    if (h3) {
      closeList();
      out.push(`<h4 class="mt-3 mb-1 text-[13px] font-semibold">${escape(h3[1])}</h4>`);
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
    const para = escape(raw)
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

export function MemoryTab({ role, initialFiles }: MemoryTabProps) {
  const [files, setFiles] = useState<string[]>(initialFiles);
  const [refreshing, setRefreshing] = useState(false);

  // Selected file state.
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileBody, setFileBody] = useState("");
  const [originalBody, setOriginalBody] = useState("");
  const [fileMtime, setFileMtime] = useState<number | null>(null);
  const [fileLoading, setFileLoading] = useState(false);

  // Mode: list (no file selected), view, edit, create.
  const [mode, setMode] = useState<Mode>("list");
  const [saving, setSaving] = useState(false);

  // Create-new state.
  const [newFilename, setNewFilename] = useState("");
  const [newBody, setNewBody] = useState("");

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const refreshFiles = useCallback(async () => {
    setRefreshing(true);
    try {
      const m = await api.agents.memory(role);
      setFiles(m.files);
    } catch {
      // Keep current list on error.
    } finally {
      setRefreshing(false);
    }
  }, [role]);

  useEffect(() => {
    void refreshFiles();
  }, [refreshFiles]);

  const openFile = useCallback(
    async (filename: string) => {
      setFileLoading(true);
      try {
        const res = await api.agents.memoryRead(role, filename);
        setSelectedFile(res.filename);
        setFileBody(res.body);
        setOriginalBody(res.body);
        setFileMtime(res.mtime);
        setMode("view");
      } catch (err) {
        toast.error(
          err instanceof ApiError
            ? `Failed to read file: ${err.message}`
            : "Failed to read file",
        );
      } finally {
        setFileLoading(false);
      }
    },
    [role],
  );

  const handleSave = useCallback(async () => {
    if (!selectedFile || saving) return;
    setSaving(true);
    try {
      await api.agents.memoryWrite(role, selectedFile, fileBody);
      setOriginalBody(fileBody);
      setMode("view");
      toast.success("Memory file saved");
    } catch (err) {
      toast.error(
        err instanceof ApiError
          ? `Save failed: ${err.message}`
          : "Save failed",
      );
    } finally {
      setSaving(false);
    }
  }, [role, selectedFile, fileBody, saving]);

  const handleDelete = useCallback(
    async (filename: string) => {
      if (
        typeof window !== "undefined" &&
        !window.confirm(`Delete "${filename}"? This cannot be undone.`)
      )
        return;
      try {
        await api.agents.memoryDelete(role, filename);
        toast.success(`Deleted ${filename}`);
        if (selectedFile === filename) {
          setSelectedFile(null);
          setMode("list");
        }
        await refreshFiles();
      } catch (err) {
        toast.error(
          err instanceof ApiError
            ? `Delete failed: ${err.message}`
            : "Delete failed",
        );
      }
    },
    [role, selectedFile, refreshFiles],
  );

  const handleCreate = useCallback(async () => {
    const name = newFilename.trim();
    if (!name) return;
    setSaving(true);
    try {
      await api.agents.memoryWrite(role, name, newBody);
      toast.success(`Created ${name}`);
      setNewFilename("");
      setNewBody("");
      await refreshFiles();
      // Open the newly created file.
      await openFile(name);
    } catch (err) {
      toast.error(
        err instanceof ApiError
          ? `Create failed: ${err.message}`
          : "Create failed",
      );
    } finally {
      setSaving(false);
    }
  }, [role, newFilename, newBody, refreshFiles, openFile]);

  const handleCancel = useCallback(() => {
    if (mode === "edit") {
      setFileBody(originalBody);
      setMode("view");
    } else if (mode === "create") {
      setNewFilename("");
      setNewBody("");
      setMode(selectedFile ? "view" : "list");
    }
  }, [mode, originalBody, selectedFile]);

  // Keyboard: Cmd/Ctrl+S to save, Esc to cancel.
  useEffect(() => {
    if (mode !== "edit" && mode !== "create") return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (mode === "edit") void handleSave();
        if (mode === "create") void handleCreate();
      } else if (e.key === "Escape") {
        e.preventDefault();
        handleCancel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, handleSave, handleCreate, handleCancel]);

  const dirty = mode === "edit" && fileBody !== originalBody;

  // --- Create mode ---
  if (mode === "create") {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold tracking-tight">New memory file</h2>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={handleCancel} className="h-7" disabled={saving}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleCreate}
              className="h-7"
              disabled={saving || !newFilename.trim()}
            >
              {saving ? "Creating..." : "Create"}
            </Button>
          </div>
        </div>
        <Input
          placeholder="filename.md"
          value={newFilename}
          onChange={(e) => setNewFilename(e.target.value)}
          autoFocus
          className="font-mono text-sm"
        />
        <div className="rounded-lg border border-border bg-card p-0">
          <Textarea
            ref={textareaRef}
            value={newBody}
            onChange={(e) => setNewBody(e.target.value)}
            placeholder="File contents..."
            spellCheck={false}
            className="min-h-[320px] w-full resize-y rounded-lg border-0 bg-transparent font-mono text-[13px] leading-relaxed focus-visible:ring-0 focus-visible:ring-offset-0"
          />
        </div>
        <div className="text-[11px] text-muted-foreground">
          <kbd className="rounded border border-border bg-secondary px-1 font-mono">Cmd+S</kbd> create
          {" "}&middot;{" "}
          <kbd className="rounded border border-border bg-secondary px-1 font-mono">Esc</kbd> cancel
        </div>
      </div>
    );
  }

  // --- View / edit mode (file selected) ---
  if (selectedFile && (mode === "view" || mode === "edit")) {
    return (
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setSelectedFile(null);
                setMode("list");
              }}
              className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label="Back to file list"
            >
              <X className="size-4" />
            </button>
            <h2 className="text-sm font-semibold tracking-tight">
              <span className="font-mono">{selectedFile}</span>
            </h2>
            {dirty && (
              <span aria-label="Unsaved changes" className="size-1.5 rounded-full bg-amber-400" />
            )}
          </div>
          <div className="flex items-center gap-2">
            {mode === "view" ? (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleDelete(selectedFile)}
                  className="h-7 gap-1 text-red-400 hover:text-red-300"
                >
                  <Trash2 className="size-3" />
                  Delete
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
                <Button size="sm" variant="ghost" onClick={handleCancel} className="h-7" disabled={saving}>
                  Cancel
                </Button>
                <Button size="sm" onClick={handleSave} className="h-7" disabled={saving || !dirty}>
                  {saving ? "Saving..." : "Save"}
                </Button>
              </>
            )}
          </div>
        </div>

        {/* Content */}
        <div className={cn("rounded-lg border border-border bg-card", mode === "edit" ? "p-0" : "p-5")}>
          {fileLoading ? (
            <div className="flex h-32 items-center justify-center text-[13px] text-muted-foreground">
              <Loader2 className="mr-2 size-4 animate-spin" />
              Loading...
            </div>
          ) : mode === "view" ? (
            renderMarkdown(fileBody)
          ) : (
            <Textarea
              ref={textareaRef}
              value={fileBody}
              onChange={(e) => setFileBody(e.target.value)}
              spellCheck={false}
              className="min-h-[480px] w-full resize-y rounded-lg border-0 bg-transparent font-mono text-[13px] leading-relaxed focus-visible:ring-0 focus-visible:ring-offset-0"
            />
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <span>
            {fileMtime ? `Modified ${new Date(fileMtime).toLocaleString()}` : ""}
          </span>
          {mode === "edit" && (
            <span>
              <kbd className="rounded border border-border bg-secondary px-1 font-mono">Cmd+S</kbd> save
              {" "}&middot;{" "}
              <kbd className="rounded border border-border bg-secondary px-1 font-mono">Esc</kbd> cancel
            </span>
          )}
        </div>
      </div>
    );
  }

  // --- File list mode ---
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span>
          {files.length} file{files.length === 1 ? "" : "s"} &middot;{" "}
          <span className="font-mono">~/.anc/agents/{role}/memory/</span>
        </span>
        <div className="flex items-center gap-2">
          {refreshing && <span>refreshing...</span>}
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setMode("create");
              setNewFilename("");
              setNewBody("");
            }}
            className="h-7 gap-1"
          >
            <Plus className="size-3" />
            New file
          </Button>
        </div>
      </div>

      {files.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-10 text-center">
          <p className="text-sm text-muted-foreground">
            No memory files yet. Agent will create them as it works, or you can{" "}
            <button
              type="button"
              onClick={() => setMode("create")}
              className="text-foreground underline"
            >
              create one
            </button>
            .
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
          {files.map((filename) => (
            <li
              key={filename}
              className="group flex items-center gap-3 px-4 py-3 text-[13px] hover:bg-accent/30"
            >
              <button
                type="button"
                onClick={() => openFile(filename)}
                className="flex min-w-0 flex-1 items-center gap-3 text-left"
              >
                <FileText className="size-4 shrink-0 text-muted-foreground" />
                <span className="font-mono">{filename}</span>
              </button>
              <button
                type="button"
                onClick={() => handleDelete(filename)}
                className="rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-red-400 group-hover:opacity-100"
                aria-label={`Delete ${filename}`}
              >
                <Trash2 className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
