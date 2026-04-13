"use client"

import * as React from "react"
import { DayPicker } from "react-day-picker"
import "react-day-picker/style.css"

import { cn } from "@/lib/utils"

export type CalendarProps = React.ComponentProps<typeof DayPicker>

function Calendar({ className, classNames, ...props }: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays
      className={cn("p-1 text-foreground", className)}
      classNames={{
        months: "flex flex-col space-y-2",
        month: "space-y-2",
        month_caption: "flex items-center justify-center pt-1 pb-1 text-sm font-medium",
        caption_label: "text-sm font-medium",
        nav: "flex items-center gap-1",
        button_previous:
          "inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground",
        button_next:
          "inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground",
        month_grid: "w-full border-collapse",
        weekdays: "flex",
        weekday:
          "w-8 text-[10px] font-medium uppercase tracking-wider text-muted-foreground",
        week: "flex w-full mt-1",
        day: "size-8 p-0 text-center text-[12px]",
        day_button:
          "inline-flex size-8 items-center justify-center rounded-md text-foreground hover:bg-accent focus:outline-none focus:ring-1 focus:ring-ring",
        selected:
          "[&>button]:bg-primary [&>button]:text-primary-foreground [&>button]:hover:bg-primary",
        today: "[&>button]:ring-1 [&>button]:ring-border",
        outside: "[&>button]:text-muted-foreground/40",
        disabled: "[&>button]:text-muted-foreground/30 [&>button]:pointer-events-none",
        hidden: "invisible",
        ...classNames,
      }}
      {...props}
    />
  )
}

export { Calendar }
