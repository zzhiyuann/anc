"use client"

import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      richColors
      closeButton
      position="bottom-right"
      duration={3500}
      icons={{
        success: <CircleCheckIcon className="size-4" strokeWidth={1.5} />,
        info: <InfoIcon className="size-4" strokeWidth={1.5} />,
        warning: <TriangleAlertIcon className="size-4" strokeWidth={1.5} />,
        error: <OctagonXIcon className="size-4" strokeWidth={1.5} />,
        loading: <Loader2Icon className="size-4 animate-spin" strokeWidth={1.5} />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border-strong)",
          "--border-radius": "12px",
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif',
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast:
            "toast-base cn-toast !shadow-[var(--shadow-lg)] !border !border-[color:var(--border-strong)] !backdrop-blur-md !text-[13px] !tracking-[-0.003em]",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
