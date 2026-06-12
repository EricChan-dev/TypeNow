"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import Link from "next/link"
import { Infinity, TrendingUp, Zap, Wallet } from "lucide-react"

const highlights = [
  {
    icon: Infinity,
    title: "永久免费学习",
    desc: "终身解锁全部会员功能，无需再续费",
    color: "text-sky-400",
    bg: "bg-sky-400/10",
    border: "border-sky-400/20",
  },
  {
    icon: TrendingUp,
    title: "高额佣金分成",
    desc: "首次 50%，续费 30%，90天归因窗口",
    color: "text-emerald-400",
    bg: "bg-emerald-400/10",
    border: "border-emerald-400/20",
  },
  {
    icon: Wallet,
    title: "随时极速提现",
    desc: "¥50起随时申请，实时到账微信零钱",
    color: "text-amber-400",
    bg: "bg-amber-400/10",
    border: "border-amber-400/20",
  },
  {
    icon: Zap,
    title: "专属推广素材",
    desc: "邀请链接、二维码海报、话术一键生成",
    color: "text-purple-400",
    bg: "bg-purple-400/10",
    border: "border-purple-400/20",
  },
]

export default function PartnerJoin() {
  const router = useRouter()
  const [agreed, setAgreed] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleJoin() {
    if (!agreed) {
      toast.error("请先同意合伙人协议")
      return
    }
    setLoading(true)
    try {
      const res = await fetch("/api/payment/create-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: "partner" }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "创建订单失败")
      router.push(
        `/home/store/checkout?out_trade_no=${data.out_trade_no}&plan=partner&code_url=${encodeURIComponent(data.code_url)}`
      )
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "操作失败")
    } finally {
      setLoading(false)
    }
  }

  const ctaBlock = (
    <div className="flex flex-col gap-3">
      <button
        onClick={handleJoin}
        disabled={loading}
        className="w-full py-3.5 rounded-2xl bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-black font-bold text-base transition-colors"
      >
        {loading ? "处理中..." : "立即开通合伙人"}
      </button>
      <label className="flex items-start gap-2.5 cursor-pointer">
        <input
          type="checkbox"
          checked={agreed}
          onChange={(e) => setAgreed(e.target.checked)}
          className="mt-0.5 accent-amber-400 shrink-0"
        />
        <span className="text-muted-foreground text-[11px] leading-relaxed">
          我已阅读并同意{" "}
          <Link href="/partner-agreement" target="_blank" className="text-amber-400 underline underline-offset-2 hover:text-amber-300">
            《合伙人推广合作协议》
          </Link>
          ，了解分销规则、冷静期及违规处理条款
        </span>
      </label>
      <p className="text-muted-foreground/50 text-[11px] text-center">
        仅限单级分销，不支持多层分佣 · 付款后享永久权益
      </p>
    </div>
  )

  return (
    <div className="min-h-full bg-background text-foreground">
      {/* Mobile sticky bottom CTA */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 z-10 bg-background/95 backdrop-blur-sm border-t border-border px-4 py-4">
        {ctaBlock}
      </div>

      {/* Main content — add bottom padding on mobile to clear sticky bar */}
      <div className="px-4 sm:px-6 py-6 pb-[180px] md:pb-8 max-w-5xl mx-auto">

        {/* Header row */}
        <div className="mb-6">
          <div className="inline-flex items-center gap-2 rounded-full bg-amber-500/10 border border-amber-500/30 px-3.5 py-1 text-xs font-medium text-amber-400 mb-3">
            合伙人专属计划
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold">边学英语，边赚真金白银</h1>
          <p className="text-muted-foreground text-sm mt-1">一次加入 · 永久权益 · 随时提现</p>
        </div>

        {/* Two-column layout on desktop */}
        <div className="flex flex-col md:flex-row gap-5">

          {/* Left column */}
          <div className="flex flex-col gap-4 md:w-[44%]">

            {/* Price card */}
            <div className="relative overflow-hidden bg-gradient-to-br from-amber-500/20 via-orange-500/10 to-transparent border border-amber-500/30 rounded-2xl p-5">
              <div className="absolute top-0 right-0 w-32 h-32 bg-amber-500/5 rounded-full -translate-y-1/2 translate-x-1/2 blur-2xl" />
              <div className="text-amber-400 text-xs font-semibold mb-2">合伙人终身会员</div>
              <div className="flex items-baseline gap-1 mb-1">
                <span className="text-muted-foreground text-sm">¥</span>
                <span className="text-4xl font-extrabold text-foreground">399</span>
                <span className="text-muted-foreground text-sm ml-1">一次性</span>
              </div>
              <p className="text-muted-foreground/70 text-xs">含全部会员权限 · 永久有效 · 无隐藏费用</p>
            </div>

            {/* Commission structure */}
            <div className="bg-muted/40 border border-border rounded-2xl p-4">
              <div className="text-muted-foreground text-[11px] font-semibold uppercase tracking-wider mb-3">
                佣金结构（注册后 90 天归因窗口内）
              </div>
              <div className="flex items-stretch gap-2.5">
                <div className="flex-1 flex flex-col items-center justify-center rounded-xl bg-emerald-500/10 border border-emerald-500/20 py-4">
                  <div className="text-3xl font-extrabold text-emerald-400">50%</div>
                  <div className="text-muted-foreground text-[11px] mt-1 text-center leading-tight">首次付款</div>
                </div>
                <div className="flex items-center text-muted-foreground/50 text-base">+</div>
                <div className="flex-1 flex flex-col items-center justify-center rounded-xl bg-sky-500/10 border border-sky-500/20 py-4">
                  <div className="text-3xl font-extrabold text-sky-400">30%</div>
                  <div className="text-muted-foreground text-[11px] mt-1 text-center leading-tight">窗口期续费</div>
                </div>
              </div>
              <p className="text-muted-foreground/50 text-[10px] text-center mt-2.5">
                90 天外付款不产生佣金 · 冷静期 15 天后佣金生效
              </p>
            </div>
          </div>

          {/* Right column */}
          <div className="flex flex-col gap-4 md:flex-1">

            {/* Highlights */}
            <div className="grid grid-cols-2 gap-2.5">
              {highlights.map((h) => (
                <div key={h.title} className={`flex flex-col gap-2 rounded-2xl border ${h.border} ${h.bg} p-3.5`}>
                  <div className="flex items-center justify-center w-8 h-8 rounded-xl bg-foreground/10 shrink-0">
                    <h.icon className={`h-4 w-4 ${h.color}`} />
                  </div>
                  <div>
                    <div className={`text-sm font-semibold ${h.color}`}>{h.title}</div>
                    <div className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">{h.desc}</div>
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop CTA */}
            <div className="hidden md:block">
              {ctaBlock}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
