import Link from "next/link"
import { Check, Minus, ArrowRight, Sparkles } from "lucide-react"
import { PricingCard } from "@/components/pricing/PricingCard"
import { PricingFAQ } from "@/components/pricing/PricingFAQ"

const freeFeatures = [
  "每天 30 句打字练习",
  "2 个开放场景",
  "最近 50 个错误智能复习",
  "每周 2 次 AI 强化",
  "基础学习统计",
]

const proFeatures = [
  "无限打字练习",
  "全部 6 个开放场景",
  "全部历史错误智能复习",
  "无限次 AI 强化训练",
  "深度统计 & 学习报告导出",
  "会员专属徽章",
]

interface ComparisonRow {
  feature: string
  free: string
  monthly: string
  yearly: string
  freeMuted?: boolean
}

const comparisonRows: ComparisonRow[] = [
  {
    feature: "打字练习",
    free: "每天 30 句",
    monthly: "无限",
    yearly: "无限",
  },
  {
    feature: "开放场景",
    free: "2 个",
    monthly: "全部 6 个",
    yearly: "全部 6 个",
  },
  {
    feature: "智能复习",
    free: "最近 50 个错误",
    monthly: "全部历史，无上限",
    yearly: "全部历史，无上限",
  },
  {
    feature: "AI 强化",
    free: "每周 2 次",
    monthly: "无限次",
    yearly: "无限次",
  },
  {
    feature: "学习统计",
    free: "基础统计",
    monthly: "深度统计 + 报告导出",
    yearly: "深度统计 + 报告导出",
  },
  {
    feature: "专属标识",
    free: "-",
    monthly: "会员徽章",
    yearly: "会员徽章",
    freeMuted: true,
  },
  {
    feature: "价格",
    free: "¥0 永久免费",
    monthly: "¥29/月",
    yearly: "¥199/年",
  },
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
          免费开始，按需升级月度或年度会员
        </p>
      </section>

      {/* Pricing Cards */}
      <section className="bg-background px-5 xl:px-20 pb-12 xl:pb-16">
        <div className="mx-auto max-w-[1200px] grid grid-cols-1 md:grid-cols-3 gap-6">
          <PricingCard
            name="普通会员"
            description="快速上手，体验核心打字练习功能"
            price="¥0"
            period="永久免费"
            features={freeFeatures}
            ctaText="免费开始"
            ctaHref="/login"
            variant="neutral"
          />
          <PricingCard
            name="月度会员"
            description="解锁全部功能，高效提升英语能力"
            price="¥29"
            period="/月"
            features={proFeatures}
            ctaText="立即订阅"
            ctaHref="/login"
            variant="emphasized"
          />
          <PricingCard
            name="年度会员"
            description="最划算的选择，解锁全部功能"
            price="¥199"
            period="/年"
            originalPrice="¥348"
            subPeriod="≈ ¥16.6/月"
            features={proFeatures}
            ctaText="立即订阅"
            ctaHref="/login"
            variant="prominent"
            badge="推荐"
            saveBadge="省 ¥149"
          />
        </div>
      </section>

      {/* Annual Savings Banner */}
      <section className="bg-background px-5 xl:px-20 pb-14 xl:pb-20">
        <div className="mx-auto max-w-[1200px]">
          <div className="flex items-center justify-center gap-4 rounded-xl bg-accent px-8 py-5">
            <Sparkles className="h-5 w-5 text-white shrink-0" />
            <span className="text-base font-semibold text-white">
              年度会员省更多：¥199/年 ≈ ¥16.6/月（相当于 5.7 折，立省 ¥149）
            </span>
          </div>
        </div>
      </section>

      {/* Feature Comparison Table */}
      <section className="bg-muted px-5 xl:px-20 py-16 xl:py-24">
        <div className="mx-auto max-w-[1000px] flex flex-col gap-10">
          <h2 className="text-[32px] font-bold text-foreground text-center">
            功能对比
          </h2>

          <div className="rounded-2xl bg-card border border-border overflow-hidden">
            {/* Table Header */}
            <div className="grid grid-cols-4 px-8 py-5 border-b border-border">
              <div className="text-sm font-bold text-muted-foreground">
                功能
              </div>
              <div className="text-sm font-bold text-muted-foreground text-center">
                普通会员
              </div>
              <div className="text-sm font-bold text-muted-foreground text-center">
                月度会员
              </div>
              <div className="text-sm font-bold text-accent text-center">
                年度会员
              </div>
            </div>

            {/* Table Rows */}
            {comparisonRows.map((row, i) => (
              <div
                key={row.feature}
                className={`grid grid-cols-4 px-8 py-4 ${
                  i % 2 === 0 ? "bg-transparent" : "bg-muted/50"
                } ${i < comparisonRows.length - 1 ? "border-b border-border" : ""}`}
              >
                <div className="text-sm text-foreground self-center">
                  {row.feature}
                </div>
                <div
                  className={`text-sm text-center self-center ${
                    row.freeMuted ? "text-muted-foreground" : "text-muted-foreground"
                  }`}
                >
                  {row.free === "-" ? (
                    <Minus className="h-4 w-4 inline text-muted-foreground/50" />
                  ) : (
                    row.free
                  )}
                </div>
                <div className="text-sm font-semibold text-success text-center self-center">
                  {row.monthly}
                </div>
                <div className="text-sm font-semibold text-success text-center self-center">
                  {row.yearly}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="bg-background px-5 xl:px-20 py-16 xl:py-24">
        <div className="mx-auto max-w-[800px] flex flex-col gap-10">
          <h2 className="text-[32px] font-bold text-foreground text-center">
            常见问题
          </h2>
          <PricingFAQ />
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="flex flex-col items-center justify-center bg-muted min-h-[360px] px-5 xl:px-20 py-16 text-center">
        <h2 className="text-[32px] sm:text-[40px] font-bold text-foreground">
          准备好提升英语了吗？
        </h2>
        <p className="mt-4 text-base text-muted-foreground max-w-md">
          免费开始，觉得好用再升级。随时可以取消。
        </p>
        <div className="mt-8">
          <Link
            href="/login"
            className="inline-flex items-center justify-center gap-2 rounded-[10px] bg-gradient-to-r from-indigo-500 via-purple-500 to-blue-500 px-8 py-4 text-base font-semibold text-white hover:opacity-90 transition-opacity"
          >
            免费开始练习
            <ArrowRight className="h-[18px] w-[18px]" />
          </Link>
        </div>
      </section>
    </div>
  )
}
