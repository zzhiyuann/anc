import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "h-7 w-full min-w-0 rounded-md border border-border bg-background/50 px-2.5 py-1 text-[12.5px] tracking-[-0.003em] transition-[border-color,box-shadow,background-color] duration-150 ease-[var(--ease-out)] outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-[12.5px] file:font-medium file:text-foreground placeholder:text-[11px] placeholder:text-muted-foreground/50 focus:border-ring focus:bg-background focus:ring-2 focus:ring-primary/30 focus-visible:border-ring focus-visible:bg-background focus-visible:ring-2 focus-visible:ring-primary/30 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/30 dark:bg-input/30 dark:disabled:bg-input/80",
        className
      )}
      {...props}
    />
  )
}

export { Input }
