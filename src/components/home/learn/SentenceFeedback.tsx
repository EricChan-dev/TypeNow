"use client"

import { useEffect, useState, useRef } from "react"
import { animate } from "animejs"

export type FeedbackVariant = "great" | "perfect" | "combo"

interface Props {
  trigger: number
  variant: FeedbackVariant
  streak: number
  /** kept for API compatibility; no longer rendered */
  earned?: number
}

let audioCtx: AudioContext | null = null
function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null
  if (!audioCtx) {
    try {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      audioCtx = new Ctor()
    } catch { return null }
  }
  if (audioCtx?.state === "suspended") audioCtx.resume().catch(() => {})
  return audioCtx
}

function playTone(freq: number, duration: number, delay = 0, volume = 0.12, type: OscillatorType = "sine") {
  const ctx = getCtx()
  if (!ctx) return
  const t0 = ctx.currentTime + delay
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, t0)
  gain.gain.setValueAtTime(0, t0)
  gain.gain.linearRampToValueAtTime(volume, t0 + 0.015)
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration)
  osc.connect(gain).connect(ctx.destination)
  osc.start(t0)
  osc.stop(t0 + duration + 0.05)
}

function playSound(variant: FeedbackVariant, streak: number) {
  if (variant === "great") {
    // Single mid chime — friendly but neutral
    playTone(523.25, 0.18, 0, 0.14, "triangle")
  } else if (variant === "perfect") {
    // Bright two-note chime (C5 → E5)
    playTone(659.25, 0.16, 0, 0.13, "triangle")
    playTone(987.77, 0.22, 0.06, 0.11, "triangle")
  } else {
    // Combo — ascending arpeggio + climax, pitch rises with streak
    const lift = Math.min(streak - 2, 12)
    const base = 523.25 * Math.pow(2, lift / 24)
    playTone(base, 0.1, 0, 0.12, "triangle")
    playTone(base * 1.25, 0.1, 0.07, 0.12, "triangle")
    playTone(base * 1.5, 0.12, 0.14, 0.13, "triangle")
    playTone(base * 2, 0.28, 0.22, 0.14, "triangle")
  }
}

const VARIANT_CONFIG: Record<FeedbackVariant, { label: (s: number) => string; gradient: string; shadow: string; ring: string }> = {
  great: {
    label: () => "GREAT",
    gradient: "linear-gradient(135deg, #06b6d4, #3b82f6)",
    shadow: "0 0 36px rgba(6,182,212,0.55)",
    ring: "rgba(6,182,212,0.4)",
  },
  perfect: {
    label: () => "PERFECT",
    gradient: "linear-gradient(135deg, #a855f7, #ec4899)",
    shadow: "0 0 38px rgba(168,85,247,0.55)",
    ring: "rgba(168,85,247,0.45)",
  },
  combo: {
    label: (s) => `PERFECT ×${s} COMBO!`,
    gradient: "linear-gradient(135deg, #f59e0b, #ef4444, #ec4899)",
    shadow: "0 0 44px rgba(239,68,68,0.6)",
    ring: "rgba(239,68,68,0.5)",
  },
}

export function SentenceFeedback({ trigger, variant, streak }: Props) {
  const [visible, setVisible] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)
  const ringRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (trigger === 0) return
    setVisible(true)
    playSound(variant, streak)
    requestAnimationFrame(() => {
      if (cardRef.current) {
        animate(cardRef.current, {
          opacity: [0, 1, 1, 0],
          scale: [0.55, 1.18, 1.0, 0.92],
          translateY: [0, -8, -8, -56],
          duration: 1500,
          ease: "out(2)",
          onComplete: () => setVisible(false),
        })
      }
      if (ringRef.current) {
        animate(ringRef.current, {
          opacity: [0.6, 0],
          scale: [0.6, 2.4],
          duration: 700,
          ease: "out(2)",
        })
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger])

  if (!visible) return null

  const cfg = VARIANT_CONFIG[variant]

  return (
    <div className="fixed top-[22%] left-1/2 -translate-x-1/2 z-[60] pointer-events-none">
      <div
        ref={ringRef}
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-32 h-32 rounded-full"
        style={{ background: cfg.ring }}
      />
      <div
        ref={cardRef}
        className="relative px-7 py-3.5 rounded-2xl text-white font-black flex items-center gap-3 whitespace-nowrap"
        style={{
          background: cfg.gradient,
          boxShadow: cfg.shadow,
          fontSize: variant === "combo" ? 28 : 26,
          letterSpacing: "0.04em",
        }}
      >
        <span>{cfg.label(streak)}</span>
      </div>
    </div>
  )
}
