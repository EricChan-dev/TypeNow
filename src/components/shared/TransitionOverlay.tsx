"use client"

import { useEffect, useState } from "react"
import { Loader2 } from "lucide-react"

interface TransitionOverlayProps {
  show: boolean
  message?: string
  duration?: number // ms, default 1500
  onComplete?: () => void
}

export function TransitionOverlay({
  show,
  message = "加载中…",
  duration = 1500,
  onComplete,
}: TransitionOverlayProps) {
  const [visible, setVisible] = useState(false)
  const [animateOut, setAnimateOut] = useState(false)

  useEffect(() => {
    if (show) {
      setVisible(true)
      setAnimateOut(false)
      const timer = setTimeout(() => {
        setAnimateOut(true)
        setTimeout(() => {
          setVisible(false)
          onComplete?.()
        }, 400)
      }, duration)
      return () => clearTimeout(timer)
    } else {
      setVisible(false)
    }
  }, [show, duration, onComplete])

  if (!visible) return null

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-black transition-opacity duration-400 ${
        animateOut ? "opacity-0" : "opacity-100"
      }`}
    >
      <div className="flex flex-col items-center gap-4">
        {/* Animated ring */}
        <div className="relative">
          <div className="h-16 w-16 rounded-full border-2 border-white/10" />
          <div className="absolute inset-0 h-16 w-16 rounded-full border-2 border-transparent border-t-accent animate-spin" />
          <div className="absolute inset-2 h-12 w-12 rounded-full border-2 border-transparent border-r-accent/60 animate-spin" style={{ animationDirection: "reverse", animationDuration: "0.8s" }} />
        </div>
        <p className="text-base font-medium text-white/60 animate-pulse">{message}</p>
      </div>
    </div>
  )
}
