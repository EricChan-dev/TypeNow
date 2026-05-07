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
        className={`p-1.5 rounded text-white/60 hover:text-white hover:bg-white/10 transition-colors ${className}`}
        {...props}
      >
        {children}
      </button>
      <span className="absolute left-1/2 -translate-x-1/2 -bottom-7 px-2 py-0.5 rounded text-[11px] text-white/70 bg-[#2a2a2a] border border-white/10 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity duration-100 pointer-events-none z-50">
        {label}
      </span>
    </div>
  )
}
