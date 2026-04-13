"use client"

import * as React from "react"
import { Separator } from "react-resizable-panels"

import { cn } from "@/lib/utils"

/**
 * Vertical drag handle for `react-resizable-panels` Group/Panel layouts.
 * 1px border-colored line that widens to a 3px brand-tinted line on
 * hover/focus.
 */
export function ResizeHandle({
  className,
  ...props
}: React.ComponentProps<typeof Separator>) {
  return (
    <Separator
      title="Drag to resize"
      className={cn(
        "group/resize-handle relative flex w-px shrink-0 cursor-col-resize bg-border outline-none transition-colors hover:bg-primary/70 focus-visible:bg-primary/70",
        className,
      )}
      {...props}
    >
      {/* Wider invisible hit area for easier grabbing */}
      <span aria-hidden className="absolute inset-y-0 -left-1 -right-1 z-10" />
      {/* Visible 3px overlay on hover/focus */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 -left-px w-[3px] bg-primary/70 opacity-0 transition-opacity group-hover/resize-handle:opacity-100 group-focus-visible/resize-handle:opacity-100"
      />
    </Separator>
  )
}
