"use client"

import { useState, useEffect } from "react"
import Image from "next/image"
import { X } from "lucide-react"
import { toast } from "sonner"
import { TRIAL_DAYS } from "@/lib/trial-days"

const STORAGE_KEY = "welcome_trial_offer_shown"

/**
 * 新用户首页的体验会员领取入口。
 *
 * 这个组件原先写死「🎉 恭喜获得 3 天体验会员」，配合的是「注册无条件送 3 天」。
 * 现在注册不再自动送（未受邀用户没有会员，见 db/migrations/00012_trial_claim.sql），
 * 那句话就成了假话 —— 用户会被恭喜拿到一份并不存在的权益。
 * 因此改为如实的领取邀请：只在「还没领过」时出现，点一下真的去领。
 *
 * 与试学墙（LearnClient 里练完 3 句后的弹窗）是同一个动作的两个入口：
 * 这个负责让还没开始练的人也知道有免费的 5 天，那个负责在用户最想要的时刻承接。
 */
export function WelcomeTrialModal() {
  const [open, setOpen] = useState(false)
  const [claiming, setClaiming] = useState(false)

  useEffect(() => {
    if (sessionStorage.getItem(STORAGE_KEY)) return
    let cancelled = false

    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return
        // 只在拿到明确答复后才记「已展示」，接口失败时下次还会再问一遍，
        // 免得一次网络抖动就让用户永远看不到这个入口。
        sessionStorage.setItem(STORAGE_KEY, "1")
        if (data?.user?.trial_available) setOpen(true)
      })
      .catch(() => {})

    return () => {
      cancelled = true
    }
  }, [])

  async function claim() {
    if (claiming) return
    setClaiming(true)
    try {
      const res = await fetch("/api/trial/claim", { method: "POST" })
      if (res.ok) {
        toast.success(`已领取 ${TRIAL_DAYS} 天体验会员`)
        window.location.reload()
        return
      }
      const data = await res.json().catch(() => null)
      toast.error(data?.error ?? "领取失败，请稍后再试")
      setOpen(false)
    } catch {
      toast.error("网络异常，请稍后再试")
    }
    setClaiming(false)
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/65 backdrop-blur-sm">
      <div className="relative max-w-sm w-full rounded-2xl bg-card border border-border p-6 shadow-2xl">
        <button
          onClick={() => setOpen(false)}
          aria-label="关闭"
          className="absolute top-4 right-4 p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="flex flex-col items-center text-center gap-4">
          <div className="flex items-center justify-center w-16 h-16 rounded-2xl" style={{ background: "linear-gradient(135deg, #b45309, #f59e0b)" }}>
            <Image src="/VIP.png" alt="VIP" width={36} height={36} />
          </div>

          <div>
            <h2 className="text-xl font-bold text-foreground">
              🎁 免费领取 {TRIAL_DAYS} 天体验会员
            </h2>
            <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
              解锁全部课程与完整功能，先体验，再决定要不要开通。
            </p>
          </div>

          <div className="flex flex-col gap-2.5 w-full mt-1">
            <button
              onClick={claim}
              disabled={claiming}
              className="w-full py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90 active:scale-95 disabled:opacity-50"
              style={{ background: "linear-gradient(135deg, #7c3aed, #a855f7)" }}
            >
              {claiming ? "领取中…" : `免费领取 ${TRIAL_DAYS} 天`}
            </button>
            <button
              onClick={() => setOpen(false)}
              className="w-full py-2.5 rounded-xl text-sm font-semibold text-muted-foreground border border-border hover:bg-muted transition-colors"
            >
              先去逛逛
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
