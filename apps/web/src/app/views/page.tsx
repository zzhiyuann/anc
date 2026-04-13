"use client";

export default function ViewsPage() {
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-6">
        <div>
          <h1 className="text-[14px] font-semibold tracking-tight">Views</h1>
        </div>
        <button
          type="button"
          className="flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          <svg className="size-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M8 3v10M3 8h10" />
          </svg>
          New view
        </button>
      </div>

      <div className="flex flex-1 items-center justify-center px-6">
        <div className="max-w-md text-center">
          <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-xl border border-border bg-secondary/40 text-muted-foreground">
            <svg className="size-5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M2 4h12M2 8h12M2 12h8" />
            </svg>
          </div>
          <h2 className="text-[14px] font-semibold text-foreground">No saved views yet</h2>
          <p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">
            Create filter combinations on the Tasks page and save them here for quick access.
          </p>
        </div>
      </div>
    </div>
  );
}
