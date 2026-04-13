import * as React from "react"

import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-14 w-full rounded-md border border-border bg-background/50 px-2.5 py-1.5 text-[12.5px] tracking-[-0.003em] leading-relaxed transition-[border-color,box-shadow,background-color] duration-150 ease-[var(--ease-out)] outline-none placeholder:text-[11px] placeholder:text-muted-foreground/50 focus:border-ring focus:bg-background focus:ring-2 focus:ring-primary/30 focus-visible:border-ring focus-visible:bg-background focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/30 dark:bg-input/30 dark:disabled:bg-input/80",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
