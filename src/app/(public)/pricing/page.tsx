import Link from "next/link"
import { ArrowRight, Sparkles } from "lucide-react"
import { Check, Minus } from "lucide-react"
import { PricingClient } from "@/components/pricing/PricingClient"
import { PricingFAQ } from "@/components/pricing/PricingFAQ"

interface ComparisonRow {
  feature: string
  monthly: string
  yearly: string
  partner: string
}

const comparisonRows: ComparisonRow[] = [
  { feature: "打字练习", monthly: "无限", yearly: "无限", partner: "无限" },
  { feature: "开放场景", monthly: "全部 6 个", yearly: "全部 6 个", partner: "全部 6 个" },
  { feature: "智能复习", monthly: "全部历史，无上限", yearly: "全部历史，无上限", partner: "全部历史，无上限" },
  { feature: "AI 强化", monthly: "无限次", yearly: "无限次", partner: "无限次" },
  { feature: "学习统计", monthly: "深度统计 + 报告导出", yearly: "深度统计 + 报告导出", partner: "深度统计 + 报告导出" },
  { feature: "会员有效期", monthly: "按月", yearly: "按年", partner: "永久终身" },
  { feature: "专属邀请链接", monthly: "-", yearly: "-", partner: "✓" },
  { feature: "分享海报 / 二维码", monthly: "-", yearly: "-", partner: "✓" },
  { feature: "首次付款佣金（90天内）", monthly: "-", yearly: "-", partner: "50%" },
  { feature: "续费佣金（90天内）", monthly: "-", yearly: "-", partner: "30%" },
  { feature: "随时提现", monthly: "-", yearly: "-", partner: "¥50 起" },
  { feature: "价格", monthly: "¥29/月", yearly: "¥199/年", partner: "¥399 终身" },
]

export default function PricingPage() {
  return (
    <div className="flex flex-col">
      {/* Hero */}
      <section className="flex flex-col items-center bg-background px-5 xl:px-20 pt-20 xl:pt-28 pb-10 text-center">
        <h1 className="text-[42px] sm:text-[48px] font-extrabold text-foreground leading-[1.15] tracking-tight">
          选择适合你的方案
        </h1>
        <p className="mt-5 text-lg text-muted-foreground max-w-lg">
          按需选择，合伙人会员可边学边赚取高额佣金
        </p>
      </section>

      {/* Pricing Cards (client component with checkout modal) */}
      <section className="bg-background px-5 xl:px-20 pb-12 xl:pb-16">
        <div className="mx-auto max-w-[1200px]">
          <PricingClient />
        </div>
      </section>

      {/* Annual Savings Banner */}
      <section className="bg-background px-5 xl:px-20 pb-14 xl:pb-20">
        <div className="mx-auto max-w-[1200px]">
          <div className="flex items-center justify-center gap-4 rounded-xl bg-accent px-8 py-5">
            <Sparkles className="h-5 w-5 text-white shrink-0" />
            <span className="text-base font-semibold text-white">
              合伙人会员：¥399 一次性 · 永久免费使用 + 分享赚取最高 50% 佣金
            </span>
          </div>
        </div>
      </section>

      {/* Feature Comparison Table */}
      <section className="bg-muted px-5 xl:px-20 py-16 xl:py-24">
        <div className="mx-auto max-w-[1100px] flex flex-col gap-10">
          <h2 className="text-[32px] font-bold text-foreground text-center">
            功能对比
          </h2>

          <div className="rounded-2xl bg-card border border-border overflow-hidden">
            <div className="grid grid-cols-4 px-8 py-5 border-b border-border">
              <div className="text-sm font-bold text-muted-foreground">功能</div>
              <div className="text-sm font-bold text-muted-foreground text-center">月度会员</div>
              <div className="text-sm font-bold text-accent text-center">年度会员</div>
              <div className="text-sm font-bold text-amber-500 text-center">合伙人会员</div>
            </div>

            {comparisonRows.map((row, i) => (
              <div
                key={row.feature}
                className={`grid grid-cols-4 px-8 py-4 ${
                  i % 2 === 0 ? "bg-transparent" : "bg-muted/50"
                } ${i < comparisonRows.length - 1 ? "border-b border-border" : ""}`}
              >
                <div className="text-sm text-foreground self-center">{row.feature}</div>
                <div className="text-sm text-center self-center">
                  {row.monthly === "-" ? (
                    <Minus className="h-4 w-4 inline text-muted-foreground/40" />
                  ) : (
                    <span className="font-semibold text-success">{row.monthly}</span>
                  )}
                </div>
                <div className="text-sm text-center self-center">
                  {row.yearly === "-" ? (
                    <Minus className="h-4 w-4 inline text-muted-foreground/40" />
                  ) : (
                    <span className="font-semibold text-success">{row.yearly}</span>
                  )}
                </div>
                <div className="text-sm text-center self-center">
                  {row.partner === "-" ? (
                    <Minus className="h-4 w-4 inline text-muted-foreground/40" />
                  ) : row.partner === "✓" ? (
                    <Check className="h-4 w-4 inline text-amber-500" />
                  ) : (
                    <span className="font-semibold text-amber-500">{row.partner}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="bg-background px-5 xl:px-20 py-16 xl:py-24">
        <div className="mx-auto max-w-[800px] flex flex-col gap-10">
          <h2 className="text-[32px] font-bold text-foreground text-center">常见问题</h2>
          <PricingFAQ />
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="flex flex-col items-center justify-center bg-muted min-h-[360px] px-5 xl:px-20 py-16 text-center">
        <h2 className="text-[32px] sm:text-[40px] font-bold text-foreground">
          准备好提升英语了吗？
        </h2>
        <p className="mt-4 text-base text-muted-foreground max-w-md">
          立即开始，觉得好用再升级。合伙人会员边学边赚。
        </p>
        <div className="mt-8 flex items-center gap-4">
          <Link
            href="/login"
            className="inline-flex items-center justify-center gap-2 rounded-[10px] bg-gradient-to-r from-indigo-500 via-purple-500 to-blue-500 px-8 py-4 text-base font-semibold text-white hover:opacity-90 transition-opacity"
          >
            立即开始练习
            <ArrowRight className="h-[18px] w-[18px]" />
          </Link>
          <Link
            href="/home/partner"
            className="inline-flex items-center justify-center gap-2 rounded-[10px] border border-amber-500/50 px-8 py-4 text-base font-semibold text-amber-500 hover:bg-amber-500/10 transition-colors"
          >
            了解合伙人计划
          </Link>
        </div>
      </section>
    </div>
  )
}
