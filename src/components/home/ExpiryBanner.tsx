"use client"

import { useState, useEffect, useRef } from "react"
import Link from "next/link"
import { X } from "lucide-react"

type MemberTier = "trial" | "monthly" | "yearly" | "partner" | "free"

interface ExpiryBannerProps {
  memberTier: MemberTier
  proExpires: string | null
}

const STORAGE_KEY = "expiry_banner_dismissed"
const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000

function formatCountdown(ms: number): string {
  if (ms <= 0) return "00:00:00"
  const totalSecs = Math.floor(ms / 1000)
  const h = Math.floor(totalSecs / 3600)
  const m = Math.floor((totalSecs % 3600) / 60)
  const s = totalSecs % 60
  return [h, m, s].map((v) => String(v).padStart(2, "0")).join(":")
}

export function ExpiryBanner({ memberTier, proExpires }: ExpiryBannerProps) {
  const [dismissed, setDismissed] = useState(false)
  const [countdown, setCountdown] = useState("")
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const expiresAt = proExpires ? new Date(proExpires).getTime() : null

  const shouldShow =
    !dismissed &&
    memberTier !== "partner" &&
    memberTier !== "free" &&
    expiresAt !== null &&
    expiresAt - Date.now() < THREE_DAYS_MS &&
    expiresAt > Date.now()

  useEffect(() => {
    const today = new Date().toDateString()
    const stored = sessionStorage.getItem(STORAGE_KEY)
    if (stored === today) setDismissed(true)
  }, [])

  useEffect(() => {
    if (!shouldShow || expiresAt === null) return

    function tick() {
      setCountdown(formatCountdown(expiresAt! - Date.now()))
    }
    tick()
    intervalRef.current = setInterval(tick, 1000)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [shouldShow, expiresAt])

  if (!shouldShow) return null

  function handleDismiss() {
    sessionStorage.setItem(STORAGE_KEY, new Date().toDateString())
    setDismissed(true)
  }

  const isTrial = memberTier === "trial"

  return (
    <div className="w-full flex items-center justify-center gap-3 py-2 px-4 text-sm font-medium bg-gradient-to-r from-amber-500/15 to-orange-500/15 border-b border-amber-500/25">
      <span className="text-foreground/80">
        {isTrial ? "🎁 新人专属优惠 · 体验即将结束，剩余" : "👑 会员专属优惠 · 会员即将到期，剩余"}
      </span>
      <span className="font-mono font-bold text-amber-600 dark:text-amber-400">{countdown}</span>
      <Link
        href="/pricing"
        className="rounded-lg bg-violet-600 text-white hover:bg-violet-700 text-xs px-3 py-1 font-semibold transition-colors shrink-0"
      >
        {isTrial ? "立即升级" : "立即续费"}
      </Link>
      <button
        onClick={handleDismiss}
        className="shrink-0 p-1 rounded text-foreground/30 hover:text-foreground/60 transition-colors"
        aria-label="关闭"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
