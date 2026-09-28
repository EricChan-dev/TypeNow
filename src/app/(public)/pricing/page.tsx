import Link from "next/link"
import { ArrowRight, Sparkles } from "lucide-react"
import { Check, Minus } from "lucide-react"
import { PricingClient } from "@/components/pricing/PricingClient"
import { PricingFAQ } from "@/components/pricing/PricingFAQ"
import { cn } from "@/lib/utils"
import { COMPARISON_ROWS, NOT_APPLICABLE } from "@/lib/membership-benefits"

/**
 * 对比表单元格。
 *
 * 表格数据全部来自 lib/membership-benefits 的 COMPARISON_ROWS（唯一事实源），
 * 这里只负责把 `-` / `✓` 两种约定值渲染成图形。
 */
function ComparisonCell({ value, tone }: { value: string; tone?: string }) {
  if (value === NOT_APPLICABLE) {
    return (
      <div className="text-sm text-center self-center">
        <Minus className="h-4 w-4 inline text-muted-foreground/40" />
      </div>
    )
  }
  if (value === "✓") {
    return (
      <div className="text-sm text-center self-center">
        <Check className={cn("h-4 w-4 inline", tone)} />
      </div>
    )
  }
  return (
    <div className="text-sm text-center self-center">
      <span className={cn("font-semibold", tone)}>{value}</span>
    </div>
  )
}

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
            {/* 5 列在手机上会挤，允许横向滚动（原来 4 列时就已经溢出，只是没人注意） */}
            <div className="overflow-x-auto">
              <div className="min-w-[760px]">
                <div className="grid grid-cols-5 px-8 py-5 border-b border-border">
                  <div className="text-sm font-bold text-muted-foreground">功能</div>
                  <div className="text-sm font-bold text-muted-foreground text-center">免费</div>
                  <div className="text-sm font-bold text-muted-foreground text-center">月度会员</div>
                  <div className="text-sm font-bold text-accent text-center">年度会员</div>
                  <div className="text-sm font-bold text-amber-500 text-center">合伙人会员</div>
                </div>

                {COMPARISON_ROWS.map((row, i) => (
                  <div
                    key={row.feature}
                    className={cn(
                      "grid grid-cols-5 px-8 py-4",
                      i % 2 === 0 ? "bg-transparent" : "bg-muted/50",
                      i < COMPARISON_ROWS.length - 1 && "border-b border-border",
                    )}
                  >
                    <div className="text-sm text-foreground self-center">{row.feature}</div>
                    {/* 免费列用中性色：它是对照基准，不该和付费列抢注意力 */}
                    <ComparisonCell value={row.free} tone="text-foreground/70" />
                    <ComparisonCell value={row.monthly} tone="text-success" />
                    <ComparisonCell value={row.yearly} tone="text-success" />
                    <ComparisonCell value={row.partner} tone="text-amber-500" />
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* 如实说明付费档之间没有功能差别 —— 差异只在时长与推广权益。
              这也是句乐部的做法（其官方 FAQ 专门回答"几种会员权益一样吗"），
              目的是避免"买了月卡发现功能不够"的挫败感。 */}
          <p className="text-sm text-muted-foreground text-center">
            月度与年度会员的功能完全相同，只差时长与价格；合伙人会员额外获得推广权益。
          </p>
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
