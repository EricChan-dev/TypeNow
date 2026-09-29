"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import Link from "next/link"
import { Share2, TrendingUp, Wallet, Zap } from "lucide-react"

const highlights = [
  {
    icon: TrendingUp,
    title: "按成交金额计佣",
    desc: "首次 50%、窗口期续费 30%，按被推荐人的实际付费金额计算",
    color: "text-emerald-400",
    bg: "bg-emerald-400/10",
    border: "border-emerald-400/20",
  },
  {
    icon: Wallet,
    title: "满 ¥50 可提现",
    desc: "申请后转账至微信零钱，需先绑定微信",
    color: "text-amber-400",
    bg: "bg-amber-400/10",
    border: "border-amber-400/20",
  },
  {
    icon: Share2,
    title: "专属推广素材",
    desc: "邀请链接、二维码海报一键生成",
    color: "text-purple-400",
    bg: "bg-purple-400/10",
    border: "border-purple-400/20",
  },
  {
    icon: Zap,
    title: "免费加入",
    desc: "不收取任何费用，没有加盟费、保证金或指定礼包",
    color: "text-sky-400",
    bg: "bg-sky-400/10",
    border: "border-sky-400/20",
  },
]

/**
 * 推广中心 · 加入页。
 *
 * ── 2026-09-29 合规改造（改这个文件之前先读）────────────────────────────────
 *
 * 这一页此前是「¥399 合伙人开通页」：正中央一张价格卡，按钮写"立即开通合伙人"。
 * 那正是《禁止传销条例》第七条(二)「变相入门费」在**经营对象**层面的呈现 ——
 * 用户付钱买到的是"发展他人加入的资格"。
 *
 * 现在改成**免费加入**：
 *   · 没有任何价格、没有付款入口；
 *   · 唯一的动作是"同意《推广合作协议》" → POST /api/partner/join
 *     → 写入 partner_agreed_at（这是合规检查要看的留档证据）；
 *   · 措辞严格限定为"按被推荐人的**实际付费金额**获得佣金"，
 *     不出现"零风险""躺赚""月入过万""团队""下线"等词（禁用词清单见
 *     docs/distribution-compliance.md 第七节）。
 *
 * ⚠️ 不要在这一页重新加入任何付费门槛或收益承诺。
 */
export default function PartnerJoin() {
  const router = useRouter()
  const [agreed, setAgreed] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleJoin() {
    if (!agreed) {
      toast.error("请先阅读并同意《推广合作协议》")
      return
    }
    setLoading(true)
    try {
      const res = await fetch("/api/partner/join", { method: "POST" })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "加入失败")
      toast.success("已加入推广计划")
      router.refresh()
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
        {loading ? "处理中..." : "免费加入推广计划"}
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
            《推广合作协议》
          </Link>
          ，了解佣金计算方式、冷静期与违规处理条款
        </span>
      </label>
      <p className="text-muted-foreground/50 text-[11px] text-center">
        仅单级推广：A 推荐 B，A 按 B 的实际付费金额获得佣金；B 再推荐 C，A 不从 C 获得任何收益
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
      <div className="px-4 sm:px-6 py-6 pb-[200px] md:pb-8 max-w-5xl mx-auto">

        {/* Header row */}
        <div className="mb-6">
          <div className="inline-flex items-center gap-2 rounded-full bg-amber-500/10 border border-amber-500/30 px-3.5 py-1 text-xs font-medium text-amber-400 mb-3">
            免费加入 · 无需付费
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold">分享给朋友，按实际成交拿佣金</h1>
          <p className="text-muted-foreground text-sm mt-1">
            任何注册用户都可以加入，不收取任何费用
          </p>
        </div>

        {/* Two-column layout on desktop */}
        <div className="flex flex-col md:flex-row gap-5">

          {/* Left column */}
          <div className="flex flex-col gap-4 md:w-[44%]">

            {/* 佣金结构（替代原来的价格卡） */}
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
                佣金以被推荐人的实际付费金额为计算依据，不以发展人员数量计酬 ·
                90 天外付款不产生佣金 · 冷静期 15 天后佣金可提现
              </p>
            </div>

            {/* 合规说明：主动声明规则，是检查时最有用的东西 */}
            <div className="bg-muted/40 border border-border rounded-2xl p-4">
              <div className="text-muted-foreground text-[11px] font-semibold uppercase tracking-wider mb-2">
                推广规则
              </div>
              <ul className="text-[11px] text-muted-foreground space-y-1.5 leading-relaxed">
                <li>· 免费加入，不收取加盟费、保证金、培训费，也不需要购买任何礼包</li>
                <li>· 仅单级推广，不存在多层级或团队计酬</li>
                <li>· 佣金按实际成交金额计算，退款或撤单会同步冲正</li>
                <li>· 佣金收入需依法申报纳税，平台按规定履行扣缴与报送义务</li>
              </ul>
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
