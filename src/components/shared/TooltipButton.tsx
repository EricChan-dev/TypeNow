"use client"

import type { ReactNode, ButtonHTMLAttributes } from "react"

interface TooltipButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string
  children: ReactNode
}

export function TooltipButton({ label, children, className = "", ...props }: TooltipButtonProps) {
  return (
    <div className="relative group">
      <button
        className={`p-1.5 rounded text-foreground/60 hover:text-foreground hover:bg-foreground/10 transition-colors ${className}`}
        {...props}
      >
        {children}
      </button>
      <span className="absolute left-1/2 -translate-x-1/2 -bottom-7 px-2 py-0.5 rounded text-[11px] text-foreground/80 bg-card border border-border whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity duration-100 pointer-events-none z-50">
        {label}
      </span>
    </div>
  )
}
