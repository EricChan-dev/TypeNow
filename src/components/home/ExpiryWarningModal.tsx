"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { X } from "lucide-react"

type MemberTier = "trial" | "monthly" | "yearly" | "partner" | "free"

interface Props {
  memberTier: MemberTier
  proExpires: string | null
}

const TIER_NAMES: Record<string, string> = {
  trial: "体验会员",
  monthly: "月度会员",
  yearly: "年度会员",
}

const WARN_MS: Record<string, number> = {
  trial:   24 * 3600 * 1000,
  monthly:  3 * 24 * 3600 * 1000,
  yearly:  30 * 24 * 3600 * 1000,
}

function formatTimeLeft(ms: number, tier: MemberTier): string {
  if (tier === "trial") {
    const h = Math.floor(ms / 3600000)
    const m = Math.floor((ms % 3600000) / 60000)
    return `${h}小时${m}分钟`
  }
  const days = Math.ceil(ms / (24 * 3600000))
  return `${days}天`
}

const LOSS_ITEMS = [
  "会员课程将被锁定",
  "仅可学习免费课程",
  "成为普通用户",
]

export function ExpiryWarningModal({ memberTier, proExpires }: Props) {
  const [open, setOpen] = useState(false)
  const [msLeft, setMsLeft] = useState(0)

  useEffect(() => {
    const threshold = WARN_MS[memberTier]
    if (!proExpires || !threshold) return

    const ms = new Date(proExpires).getTime() - Date.now()
    if (ms <= 0 || ms >= threshold) return

    // Show once per session per expiry timestamp
    const key = `expiry_warned_${proExpires}`
    if (sessionStorage.getItem(key)) return

    setMsLeft(ms)
    setOpen(true)
  }, [memberTier, proExpires])

  // Live minute-level countdown for trial
  useEffect(() => {
    if (!open || memberTier !== "trial") return
    const id = setInterval(() => {
      setMsLeft((prev) => {
        const next = prev - 60_000
        if (next <= 0) { clearInterval(id); return 0 }
        return next
      })
    }, 60_000)
    return () => clearInterval(id)
  }, [open, memberTier])

  function dismiss() {
    if (proExpires) sessionStorage.setItem(`expiry_warned_${proExpires}`, "1")
    setOpen(false)
  }

  if (!open) return null

  const tierName = TIER_NAMES[memberTier] ?? "会员"
  const timeLabel = memberTier === "trial" ? "剩余时间：" : "距离到期："

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/65 backdrop-blur-sm">
      <div
        className="relative w-full max-w-[340px] rounded-2xl overflow-hidden shadow-2xl"
        style={{ background: "#16100a", border: "1px solid rgba(245,158,11,0.25)" }}
      >
        {/* Close */}
        <button
          onClick={dismiss}
          className="absolute top-4 right-4 text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="h-4 w-4" />
        </button>

        {/* Header */}
        <div className="flex flex-col items-center px-6 pt-8 pb-5 gap-2">
          <div className="w-16 h-16 rounded-full flex items-center justify-center text-3xl mb-1"
            style={{ background: "rgba(120,60,10,0.55)" }}>
            ⏰
          </div>
          <h2 className="text-[18px] font-bold text-foreground">{tierName}即将过期</h2>
          <p className="text-sm text-muted-foreground">
            {timeLabel}
            <span className="text-amber-400 font-bold">{formatTimeLeft(msLeft, memberTier)}</span>
          </p>
        </div>

        {/* Loss list */}
        <div className="px-6 pb-4">
          <p className="text-[13px] text-muted-foreground mb-2.5">到期后将失去以下权益：</p>
          <div className="flex flex-col gap-2">
            {LOSS_ITEMS.map((item) => (
              <div key={item} className="flex items-center gap-2.5 text-[13px] text-foreground/70">
                <span className="text-red-500 font-bold text-xs shrink-0">✕</span>
                {item}
              </div>
            ))}
          </div>
        </div>

        {/* Upsell hint */}
        <div className="mx-5 mb-5 rounded-xl px-4 py-3"
          style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.25)" }}>
          <p className="text-amber-400 font-bold text-[13px]">🎁 限时特惠</p>
          <p className="text-muted-foreground text-xs mt-0.5">{tierName}专属优惠价，立即续费享折扣</p>
        </div>

        {/* Actions */}
        <div className="grid grid-cols-2 border-t border-border">
          <button
            onClick={dismiss}
            className="py-4 text-sm font-medium text-muted-foreground hover:bg-muted/50 transition-colors"
          >
            稍后再说
          </button>
          <Link
            href="/pricing"
            onClick={dismiss}
            className="py-4 text-sm font-bold text-black bg-amber-500 hover:bg-amber-400 transition-colors text-center"
          >
            立即购买
          </Link>
        </div>
      </div>
    </div>
  )
}
