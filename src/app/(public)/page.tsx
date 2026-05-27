import { Suspense } from "react"
import {
  Keyboard,
  Brain,
  Sparkles,
  Target,
  Calendar,
  TrendingUp,
  Timer,
  Check,
  Zap,
  Rocket,
  ArrowRight,
} from "lucide-react"
import { PricingCard } from "@/components/pricing/PricingCard"
import { PricingFAQ } from "@/components/pricing/PricingFAQ"
import { ScrollToSection } from "@/components/layout/ScrollToSection"
import { ScrollToTop } from "@/components/layout/ScrollToTop"
import { AuthLink } from "@/components/layout/AuthLink"

const proMemberFeatures = [
  "无限打字练习",
  "全部 6 个开放场景",
  "全部历史错误智能复习",
  "无限次 AI 强化训练",
  "深度统计 & 学习报告导出",
  "会员专属徽章",
]

const partnerFeatures = [
  "永久免费解锁全部会员功能",
  "生成专属邀请链接 / 二维码 / 海报",
  "90天窗口内首次付款赚取 50% 佣金",
  "90天窗口内每次续费赚取 30% 佣金",
  "¥50 起随时提现至微信零钱",
  "实时数据看板：邀请数、转化率、收益",
]

export default function LandingPage() {
  return (
    <div className="flex flex-col">
      <Suspense fallback={null}>
        <ScrollToSection />
      </Suspense>
      <ScrollToTop />
      {/* ════════════════════════════════════════
          Section 1: Hero
          ════════════════════════════════════════ */}
      <section id="hero" className="flex flex-col items-center justify-center bg-muted min-h-[680px] px-5 xl:px-20 py-16 xl:py-0 text-center">
        {/* Badge */}
        <span className="inline-flex items-center rounded-full bg-accent/10 px-4 py-1.5 text-[13px] font-medium text-accent mb-6">
          &middot; 智能复习 + AI 强化训练 &middot;
        </span>

        {/* Headline */}
        <h1 className="text-[42px] sm:text-[56px] font-extrabold text-foreground leading-[1.15] tracking-tight max-w-3xl">
          码上一小句，人生一大步
        </h1>

        {/* Subtitle */}
        <p className="mt-6 text-lg text-muted-foreground leading-relaxed max-w-xl">
          AI 驱动的中译英打字练习平台。
          <br className="hidden sm:block" />
          打一句、记一句、学会一句。
        </p>

        {/* CTA Buttons */}
        <div className="mt-8 flex items-center gap-4">
          <AuthLink
            className="inline-flex items-center justify-center rounded-[10px] bg-primary px-7 py-3.5 text-base font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
            loggedInChildren="开始练习"
          >
            免费开始练习
          </AuthLink>
          <AuthLink
            hideIfLoggedIn
            className="inline-flex items-center justify-center rounded-[10px] border-[1.5px] border-accent px-7 py-3.5 text-base font-semibold text-accent hover:bg-accent/10 transition-colors"
          >
            去登录
          </AuthLink>
        </div>

        {/* Trust line */}
        <p className="mt-6 text-[13px] text-muted-foreground">
          已服务 10,000+ 中国学习者
        </p>
      </section>

      {/* ════════════════════════════════════════
          Section 2: Layer 1 — 打字练习
          ════════════════════════════════════════ */}
      <section id="features" className="bg-background px-5 xl:px-20 py-20 xl:py-24">
        <div className="mx-auto max-w-[1280px] flex flex-col lg:flex-row items-center gap-12 lg:gap-20">
          {/* Left: Text */}
          <div className="flex-1 max-w-[580px] flex flex-col gap-7">
            <span className="inline-flex items-center gap-1.5 self-start rounded-full bg-primary/10 px-3.5 py-1.5 text-[15px] font-semibold text-primary">
              <Keyboard className="h-3.5 w-3.5" />
              Layer 1 &middot; 打字练习
            </span>

            <h2 className="text-[42px] font-bold text-foreground leading-[1.2]">
              打一句，记一句，用一句
            </h2>

            <p className="text-base text-muted-foreground leading-[1.7]">
              中译英逐词打字，即时判分反馈。不需要死记硬背，真实使用才是最好的记忆。500+ 精选场景句，让每次练习都有收获。
            </p>

            <ul className="flex flex-col gap-3">
              {[
                "即时判分，打完即知对错",
                "500+ 精选高频场景句",
                "错题自动收录进入复习队列",
              ].map((item) => (
                <li
                  key={item}
                  className="flex items-center gap-2 text-[15px] text-foreground"
                >
                  <Check className="h-4 w-4 text-success shrink-0" />
                  {item}
                </li>
              ))}
            </ul>

            <AuthLink
              className="inline-flex items-center justify-center self-start rounded-[10px] bg-primary px-7 py-3.5 text-[15px] font-bold text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              立即体验 &rarr;
            </AuthLink>
          </div>

          {/* Right: Stat Card */}
          <div className="flex-1 max-w-[440px] w-full">
            <div className="rounded-xl bg-card border border-border p-7 flex flex-col gap-3">
              <div className="flex items-center justify-center h-11 w-11 rounded-[10px] bg-primary/10">
                <Zap className="h-5 w-5 text-primary" />
              </div>
              <p className="text-[36px] font-bold text-card-foreground">500+</p>
              <p className="text-sm text-muted-foreground leading-relaxed">
                精选高频场景句，覆盖生活、职场、旅行
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════
          Section 3: Smart Review
          ════════════════════════════════════════ */}
      <section className="bg-muted px-5 xl:px-20 py-20 xl:py-24">
        <div className="mx-auto max-w-[1280px] flex flex-col lg:flex-row-reverse items-center gap-12 lg:gap-20">
          {/* Right: Text */}
          <div className="flex-1 flex flex-col gap-6">
            <span className="inline-flex items-center gap-1.5 self-start rounded-full bg-accent/10 px-3 py-1.5 text-[15px] font-semibold text-accent">
              <Brain className="h-3.5 w-3.5" />
              Layer 2 &middot; 智能复习
            </span>

            <h2 className="text-[42px] font-bold text-foreground leading-[1.2] tracking-wide">
              学了不会忘 才是真的学会
            </h2>

            <p className="text-base text-muted-foreground leading-[1.7]">
              练完一句不是结束，而是记忆的开始。系统自动收集错误句，按艾宾浩斯遗忘曲线安排复习，混入正常练习不打扰节奏。
            </p>

            <div className="flex flex-col gap-4">
              {[
                {
                  icon: Target,
                  iconBg: "bg-primary/10",
                  iconColor: "text-primary",
                  title: "自动错题收集",
                  desc: "任何错误都不放过，系统默默记录",
                },
                {
                  icon: Calendar,
                  iconBg: "bg-accent/10",
                  iconColor: "text-accent",
                  title: "科学间隔安排",
                  desc: "1 / 3 / 7 / 15 / 30 天，记忆刚开始衰减就出现",
                },
                {
                  icon: TrendingUp,
                  iconBg: "bg-success/10",
                  iconColor: "text-success",
                  title: "自动出队机制",
                  desc: "连续 3 次 Perfect 即移除复习队列",
                },
              ].map((feature) => (
                <div key={feature.title} className="flex gap-3">
                  <div
                    className={`flex items-center justify-center h-7 w-7 shrink-0 rounded-lg ${feature.iconBg} mt-0.5`}
                  >
                    <feature.icon className={`h-4 w-4 ${feature.iconColor}`} />
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[15px] font-semibold text-foreground">
                      {feature.title}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {feature.desc}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Left: Review Queue Visual */}
          <div className="flex-1 w-full">
            <div className="rounded-[20px] bg-card border border-border p-8 flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-card-foreground">
                  今日复习队列
                </span>
                <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
                  12 项待复习
                </span>
              </div>

              <div className="flex flex-col gap-3">
                {[
                  {
                    days: "1天",
                    barColor: "bg-accent",
                    labelColor: "text-accent",
                    cn: "我喜欢在公园里跑步",
                    en: "I like to run in the park.",
                    icon: Timer,
                    iconColor: "text-primary",
                  },
                  {
                    days: "3天",
                    barColor: "bg-accent/70",
                    labelColor: "text-accent/70",
                    cn: "她正在准备明天的考试",
                    en: "She is preparing for tomorrow's exam.",
                    icon: Check,
                    iconColor: "text-success",
                  },
                  {
                    days: "7天",
                    barColor: "bg-muted-foreground",
                    labelColor: "text-muted-foreground",
                    cn: "这本书比那本更有趣",
                    en: "This book is more interesting than that one.",
                    icon: Sparkles,
                    iconColor: "text-primary",
                  },
                ].map((item) => (
                  <div
                    key={item.days}
                    className="flex items-center gap-3 rounded-[10px] bg-background border border-border p-3.5"
                  >
                    <div className="flex flex-col items-center justify-center w-12 shrink-0">
                      <span
                        className={`text-[11px] font-semibold ${item.labelColor}`}
                      >
                        {item.days}
                      </span>
                      <div
                        className={`mt-0.5 h-[3px] w-8 rounded-sm ${item.barColor}`}
                      />
                    </div>
                    <div className="flex-1 flex flex-col gap-1 min-w-0">
                      <span className="text-sm font-medium text-foreground truncate">
                        {item.cn}
                      </span>
                      <span className="text-[13px] text-muted-foreground truncate">
                        {item.en}
                      </span>
                    </div>
                    <item.icon
                      className={`h-[18px] w-[18px] ${item.iconColor} shrink-0`}
                    />
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-between pt-3">
                <span className="text-xs text-muted-foreground">
                  基于艾宾浩斯遗忘曲线 &middot; 1 / 3 / 7 / 15 / 30 天
                </span>
                <span className="text-xs font-medium text-accent">
                  连续 3 次 Perfect 自动移除
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════
          Section 4: AI Training
          ════════════════════════════════════════ */}
      <section className="bg-background px-5 xl:px-20 py-20 xl:py-24">
        <div className="mx-auto max-w-[1280px] flex flex-col lg:flex-row items-center gap-12 lg:gap-20">
          {/* Left: Text */}
          <div className="flex-1 flex flex-col gap-7">
            <span className="inline-flex items-center gap-1.5 self-start rounded-full bg-card px-3.5 py-1.5 text-[15px] font-semibold text-primary">
              <Sparkles className="h-3.5 w-3.5" />
              Layer 3 &middot; AI 强化训练
            </span>

            <h2 className="text-[42px] font-bold text-foreground leading-[1.2]">
              AI 精准识别弱点
              <br />
              靶向强化训练
            </h2>

            <p className="text-base text-muted-foreground leading-[1.7]">
              系统自动分析你的练习记录，找出真正的薄弱点，生成针对性训练。选你最顺手的方式，把弱点彻底攻克。
            </p>

            <ul className="flex flex-col gap-3">
              {[
                "出题练习 · 多题型精准训练",
                "场景对话 · 真实语境中演练",
                "AI 写作批改 · 逐句优化提升",
              ].map((item) => (
                <li
                  key={item}
                  className="flex items-center gap-2 text-[15px] text-foreground"
                >
                  <Check className="h-4 w-4 text-success shrink-0" />
                  {item}
                </li>
              ))}
            </ul>
          </div>

          {/* Right: AI Quiz Mockup */}
          <div className="flex-1 max-w-[480px] w-full">
            <div className="rounded-xl bg-card border border-border overflow-hidden">
              <div className="flex items-center gap-2 bg-background px-4 py-3 border-b border-border">
                <span className="h-2.5 w-2.5 rounded-full bg-red-400" />
                <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
                <span className="ml-2 text-xs text-muted-foreground">
                  AI 强化训练
                </span>
              </div>

              <div className="p-5 flex flex-col gap-3.5">
                <span className="text-[13px] text-muted-foreground">
                  根据你的错误记录，AI 为你出题：
                </span>

                <div className="rounded-lg bg-background p-4 flex flex-col gap-2.5">
                  <p className="text-sm text-foreground leading-relaxed">
                    Choose the correct form:
                    <br />
                    She ___ to school every day.
                  </p>

                  <div className="rounded-md bg-accent px-3.5 py-2">
                    <span className="text-[13px] font-semibold text-white">
                      &#10003; &nbsp;goes
                    </span>
                  </div>

                  <div className="rounded-md bg-muted border border-border px-3.5 py-2">
                    <span className="text-[13px] text-muted-foreground">go</span>
                  </div>
                  <div className="rounded-md bg-muted border border-border px-3.5 py-2">
                    <span className="text-[13px] text-muted-foreground">
                      is going
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════
          Section 5: Testimonials
          ════════════════════════════════════════ */}
      <section className="bg-muted px-5 xl:px-20 py-20 xl:py-24">
        <div className="mx-auto max-w-[1280px] flex flex-col items-center gap-12">
          <div className="flex flex-col items-center gap-4 text-center">
            <span className="inline-flex items-center rounded-full bg-accent/10 px-3.5 py-1.5 text-[13px] font-semibold text-accent">
              真实用户反馈
            </span>
            <h2 className="text-[36px] font-bold text-foreground">
              10,000+ 学习者的真实反馈
            </h2>
            <p className="text-base text-muted-foreground">
              从职场精英到备考学生，各行各业的真实进步故事
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full">
            {[
              {
                name: "张文静",
                role: "外企销售 · 上海",
                initial: "张",
                bgColor: "bg-accent/10",
                textColor: "text-accent",
                quote:
                  "以前背了就忘，用 TypeNow 三个月后，500 多个句子还记得。打字练习真的让我把词用活了。",
              },
              {
                name: "李睿哲",
                role: "研究生 · 备考雅思",
                initial: "李",
                bgColor: "bg-success/10",
                textColor: "text-success",
                quote:
                  "备考雅思时发现了 TypeNow，AI 出题练习让我语法准确率提升了 30%，写作思路也更流畅了。",
              },
              {
                name: "王晓梅",
                role: "远程设计师 · 北京",
                initial: "王",
                bgColor: "bg-primary/10",
                textColor: "text-primary",
                quote:
                  "场景对话功能太实用了！现在和外国同事开会，我能自然接话了，不再尴尬沉默。",
              },
            ].map((testimonial) => (
              <div
                key={testimonial.name}
                className="rounded-2xl bg-card border border-border p-7 flex flex-col gap-4"
              >
                <span className="text-lg text-primary">
                  &#9733;&#9733;&#9733;&#9733;&#9733;
                </span>
                <p className="text-[15px] text-card-foreground leading-[1.7] flex-1">
                  &ldquo;{testimonial.quote}&rdquo;
                </p>
                <div className="flex items-center gap-3 pt-2">
                  <div
                    className={`flex items-center justify-center h-11 w-11 rounded-full ${testimonial.bgColor} shrink-0`}
                  >
                    <span
                      className={`text-base font-bold ${testimonial.textColor}`}
                    >
                      {testimonial.initial}
                    </span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm font-semibold text-card-foreground">
                      {testimonial.name}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {testimonial.role}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════
          Section 6: Pricing — 3 卡同层
          ════════════════════════════════════════ */}
      <section id="pricing" className="bg-background px-5 xl:px-20 py-20 xl:py-24">
        <div className="mx-auto max-w-[1200px] flex flex-col items-center gap-14">
          <div className="flex flex-col items-center gap-4 text-center">
            <h2 className="text-[36px] font-bold text-foreground">
              简单透明的定价
            </h2>
            <p className="text-base text-muted-foreground">
              按需选择适合你的方案，合伙人可边学边赚
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full">
            <PricingCard
              name="月度会员"
              description="解锁全部功能，高效提升英语能力"
              price="¥29"
              period="/月"
              features={proMemberFeatures}
              ctaText="立即订阅"
              ctaHref="/login"
              variant="neutral"
            />
            <PricingCard
              name="年度会员"
              description="最划算的选择，每天不到 6 毛钱"
              price="¥199"
              period="/年"
              originalPrice="¥348"
              subPeriod="≈ ¥16.6/月"
              features={proMemberFeatures}
              ctaText="立即订阅"
              ctaHref="/login"
              variant="emphasized"
              badge="推荐"
              saveBadge="省 ¥149"
            />
            <PricingCard
              name="合伙人会员"
              description="一次加入，永久免费学习 + 无限赚佣金"
              price="¥399"
              period="终身"
              features={partnerFeatures}
              ctaText="立即开通合伙人"
              ctaHref="/home/partner"
              variant="prominent"
              badge="高收益"
            />
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════
          Section 7: FAQ
          ════════════════════════════════════════ */}
      <section id="faq" className="bg-background px-5 xl:px-20 py-20 xl:py-24">
        <div className="mx-auto max-w-[800px] flex flex-col gap-10">
          <h2 className="text-[32px] font-bold text-foreground text-center">
            常见问题
          </h2>
          <PricingFAQ />
        </div>
      </section>

      {/* ════════════════════════════════════════
          Section 8: Final CTA
          ════════════════════════════════════════ */}
      <section className="flex flex-col items-center justify-center bg-muted min-h-[420px] px-5 xl:px-20 py-20 text-center">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-foreground/10 px-3.5 py-1.5 text-[13px] font-medium text-foreground mb-6">
          <Rocket className="h-3.5 w-3.5 text-primary" />
          今天就开始 &middot; 第一句永远是免费的
        </span>

        <h2 className="text-[40px] sm:text-[48px] font-bold text-foreground tracking-[2px]">
          码上一小句，人生一大步
        </h2>

        <p className="mt-6 text-[17px] text-muted-foreground leading-relaxed max-w-[680px]">
          加入 10,000+ 中国学习者，让英语真正变成你的第二天性。
        </p>

        <div className="mt-10">
          <AuthLink
            className="inline-flex items-center justify-center gap-2 rounded-[10px] bg-primary px-8 py-4 text-base font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            立即开始
            <ArrowRight className="h-[18px] w-[18px]" />
          </AuthLink>
        </div>
      </section>
    </div>
  )
}
