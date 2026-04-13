"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import MarkdownIt from "markdown-it";

// --- File type classification ---

const IMAGE_EXTS = new Set([
  "png", "jpg", "jpeg", "gif", "svg", "webp", "ico",
]);

const CODE_EXTS = new Set([
  "ts", "tsx", "js", "jsx", "py", "rs", "go", "sh", "bash",
  "yaml", "yml", "toml", "json", "sql", "css", "swift",
  "c", "cpp", "h", "hpp", "java", "kt", "rb", "lua",
  "zig", "nim", "ex", "exs", "erl", "hs", "ml", "ocaml",
]);

const MD_EXTS = new Set(["md", "markdown"]);
const HTML_EXTS = new Set(["html", "htm"]);

const BINARY_EXTS = new Set([
  "pdf", "zip", "tar", "gz", "bin", "exe", "dmg", "woff",
  "woff2", "ttf", "otf", "eot", "mp3", "mp4", "avi", "mov",
]);

type PreviewKind = "html" | "markdown" | "code" | "image" | "text" | "binary";

function getExtension(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot >= 0 ? filename.slice(dot + 1).toLowerCase() : "";
}

function classifyFile(filename: string, kind: string): PreviewKind {
  if (kind === "image" || IMAGE_EXTS.has(getExtension(filename))) return "image";
  if (BINARY_EXTS.has(getExtension(filename)) || kind === "binary") return "binary";
  const ext = getExtension(filename);
  if (HTML_EXTS.has(ext)) return "html";
  if (MD_EXTS.has(ext)) return "markdown";
  if (CODE_EXTS.has(ext)) return "code";
  return "text";
}

function hasBinaryContent(text: string): boolean {
  const sample = text.slice(0, 512);
  return sample.includes("\0");
}

// --- Shared markdown renderer ---

const md = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: false,
});

// --- Size helpers ---

const MAX_PREVIEW_BYTES = 50 * 1024; // 50KB

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`;
  return `${(bytes / 1024 / 1024).toFixed(2)}M`;
}

// --- Component props ---

export interface FilePreviewProps {
  taskId: string;
  path: string;
  kind: string;
  size: number;
  mtime: number;
}

export function FilePreview({ taskId, path, kind, size, mtime: _mtime }: FilePreviewProps) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const filename = path.split("/").pop() ?? path;
  const ext = getExtension(filename);
  const previewKind = classifyFile(filename, kind);

  const downloadUrl = api.taskAttachments.url(taskId, path);

  const fetchContent = useCallback(async () => {
    setLoading(true);
    setError(null);
    setContent(null);
    setTruncated(false);
    try {
      const text = await api.taskAttachments.read(taskId, path);
      if (hasBinaryContent(text)) {
        setContent(null);
        setError("binary");
        return;
      }
      if (text.length > MAX_PREVIEW_BYTES) {
        setContent(text.slice(0, MAX_PREVIEW_BYTES));
        setTruncated(true);
      } else {
        setContent(text);
      }
    } catch (err) {
      setError(
        err instanceof ApiError
          ? `Failed to load preview: ${err.message}`
          : "Failed to load preview",
      );
    } finally {
      setLoading(false);
    }
  }, [taskId, path]);

  // Fetch content for text-based preview types
  useEffect(() => {
    if (previewKind !== "image" && previewKind !== "binary") {
      void fetchContent();
    }
  }, [previewKind, fetchContent]);

  // Auto-resize iframe
  useEffect(() => {
    if (previewKind !== "html" || !content || !iframeRef.current) return;

    const iframe = iframeRef.current;
    const handleLoad = () => {
      try {
        const doc = iframe.contentDocument;
        if (doc?.body) {
          const h = doc.body.scrollHeight;
          iframe.style.height = `${Math.max(h + 16, 200)}px`;
        }
      } catch {
        // cross-origin fallback — keep min-height
      }
    };

    iframe.addEventListener("load", handleLoad);
    return () => iframe.removeEventListener("load", handleLoad);
  }, [previewKind, content]);

  const openInNewTab = useCallback(() => {
    if (!content) return;
    const blob = new Blob([content], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
  }, [content]);

  // --- Top bar ---
  const topBar = (
    <div className="flex items-center gap-2 rounded-t-lg border border-b-0 border-border bg-card px-3 py-1.5">
      <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">
        {filename}
      </span>
      <span className="text-[10px] text-muted-foreground">
        {formatSize(size)}
      </span>
      {previewKind === "html" && content && (
        <button
          type="button"
          onClick={openInNewTab}
          className="rounded px-2 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          Open in new tab
        </button>
      )}
      <a
        href={downloadUrl}
        download={filename}
        className="rounded px-2 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
      >
        Download
      </a>
    </div>
  );

  // --- Loading state ---
  if (loading) {
    return (
      <div className="mt-1">
        {topBar}
        <div className="flex items-center justify-center rounded-b-lg border border-border bg-card/50 p-6">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
          <span className="ml-2 text-xs text-muted-foreground">Loading preview...</span>
        </div>
      </div>
    );
  }

  // --- Error / binary fallback ---
  if (error) {
    if (error === "binary") {
      return (
        <div className="mt-1">
          {topBar}
          <div className="flex items-center gap-3 rounded-b-lg border border-border bg-card/50 p-4">
            <span className="text-lg">&#9632;</span>
            <div className="flex-1">
              <p className="text-xs text-muted-foreground">Binary file -- preview not available</p>
            </div>
            <a
              href={downloadUrl}
              download={filename}
              className="rounded-md border border-border bg-card px-3 py-1.5 text-xs transition-colors hover:bg-secondary"
            >
              Download
            </a>
          </div>
        </div>
      );
    }

    return (
      <div className="mt-1">
        {topBar}
        <div className="flex items-center gap-3 rounded-b-lg border border-border bg-card/50 p-4">
          <div className="flex-1">
            <p className="text-xs text-status-failed">{error}</p>
          </div>
          <button
            type="button"
            onClick={() => void fetchContent()}
            className="rounded-md border border-border bg-card px-3 py-1.5 text-xs transition-colors hover:bg-secondary"
          >
            Retry
          </button>
          <a
            href={downloadUrl}
            download={filename}
            className="rounded-md border border-border bg-card px-3 py-1.5 text-xs transition-colors hover:bg-secondary"
          >
            Download
          </a>
        </div>
      </div>
    );
  }

  // --- Image preview ---
  if (previewKind === "image") {
    return (
      <div className="mt-1">
        {topBar}
        <div className="flex items-center justify-center rounded-b-lg border border-border bg-card/50 p-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={downloadUrl}
            alt={filename}
            className="max-h-[500px] max-w-full rounded-md border border-border object-contain"
          />
        </div>
      </div>
    );
  }

  // --- Binary fallback (no fetch attempted) ---
  if (previewKind === "binary") {
    return (
      <div className="mt-1">
        {topBar}
        <div className="flex items-center gap-3 rounded-b-lg border border-border bg-card/50 p-4">
          <span className="text-lg">&#9632;</span>
          <div className="flex-1">
            <p className="text-xs text-muted-foreground">Binary file -- preview not available</p>
          </div>
          <a
            href={downloadUrl}
            download={filename}
            className="rounded-md border border-border bg-card px-3 py-1.5 text-xs transition-colors hover:bg-secondary"
          >
            Download
          </a>
        </div>
      </div>
    );
  }

  // --- Empty file ---
  if (content !== null && content.length === 0) {
    return (
      <div className="mt-1">
        {topBar}
        <div className="flex items-center justify-center rounded-b-lg border border-border bg-card/50 p-6">
          <span className="text-xs text-muted-foreground">Empty file</span>
        </div>
      </div>
    );
  }

  // --- Truncation banner ---
  const truncationBanner = truncated ? (
    <div className="border-t border-border bg-card/80 px-3 py-2 text-center text-[10px] text-muted-foreground">
      File too large for full preview (showing first 50KB).{" "}
      <a
        href={downloadUrl}
        download={filename}
        className="underline hover:text-foreground"
      >
        Download full file
      </a>
    </div>
  ) : null;

  // --- HTML preview ---
  if (previewKind === "html" && content) {
    return (
      <div className="mt-1">
        {topBar}
        <div className="rounded-b-lg border border-border">
          <iframe
            ref={iframeRef}
            srcDoc={content}
            sandbox="allow-same-origin"
            title={filename}
            style={{
              width: "100%",
              minHeight: 400,
              border: "none",
              borderRadius: "0 0 8px 8px",
              background: "white",
            }}
          />
          {truncationBanner}
        </div>
      </div>
    );
  }

  // --- Markdown preview ---
  if (previewKind === "markdown" && content) {
    const rendered = md.render(content);
    return (
      <div className="mt-1">
        {topBar}
        <div className="max-h-[500px] overflow-auto rounded-b-lg border border-border bg-card/50 p-4">
          <div
            className="anc-markdown max-w-none text-sm leading-relaxed [&_a]:text-primary [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_code]:rounded [&_code]:bg-secondary [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[11px] [&_h1]:mb-2 [&_h1]:mt-4 [&_h1]:text-base [&_h1]:font-semibold [&_h2]:mb-2 [&_h2]:mt-3 [&_h2]:text-sm [&_h2]:font-semibold [&_h3]:mb-1 [&_h3]:mt-2 [&_h3]:text-xs [&_h3]:font-semibold [&_hr]:my-3 [&_hr]:border-border [&_img]:max-w-full [&_img]:rounded [&_li]:ml-4 [&_ol]:list-decimal [&_ol]:pl-4 [&_p]:mb-2 [&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-secondary [&_pre]:p-2 [&_pre]:font-mono [&_pre]:text-[11px] [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1 [&_td]:text-xs [&_th]:border [&_th]:border-border [&_th]:bg-secondary/50 [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:text-xs [&_th]:font-semibold [&_ul]:list-disc [&_ul]:pl-4"
            dangerouslySetInnerHTML={{ __html: rendered }}
          />
          {truncationBanner}
        </div>
      </div>
    );
  }

  // --- Code preview ---
  if (previewKind === "code" && content) {
    const lines = content.split("\n");
    return (
      <div className="mt-1">
        {topBar}
        <div className="relative rounded-b-lg border border-border bg-[oklch(0.07_0.005_260)]">
          <div className="absolute right-2 top-2 rounded bg-secondary/60 px-1.5 py-0.5 font-mono text-[9px] uppercase text-muted-foreground">
            {ext}
          </div>
          <div className="max-h-[500px] overflow-auto p-3">
            <pre className="font-mono text-[11px] leading-relaxed">
              <code>
                {lines.map((line, i) => (
                  <div key={i} className="flex">
                    <span className="mr-3 inline-block w-8 select-none text-right text-muted-foreground/50">
                      {i + 1}
                    </span>
                    <span className="flex-1 whitespace-pre-wrap break-all">
                      {line || "\n"}
                    </span>
                  </div>
                ))}
              </code>
            </pre>
          </div>
          {truncationBanner}
        </div>
      </div>
    );
  }

  // --- Text / fallback preview ---
  if (content) {
    return (
      <div className="mt-1">
        {topBar}
        <div className="max-h-[500px] overflow-auto rounded-b-lg border border-border bg-[oklch(0.07_0.005_260)] p-3">
          <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed">
            {content}
          </pre>
          {truncationBanner}
        </div>
      </div>
    );
  }

  return null;
}
