import { Suspense } from "react"
import Image from "next/image"
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
import { LIFETIME_BENEFITS, PRO_BENEFITS } from "@/lib/membership-benefits"
import { findPlan, formatYuan, planPeriodSuffix, planPriceNote, planSaveNote } from "@/lib/pricing"
import type { Metadata } from "next"

// 落地页此前也没有页面级 metadata：搜索结果里显示的是根 layout 的泛化描述，
// 而这里才是最该自己说话的一页。
export const metadata: Metadata = {
  title: "TypeNow 码上英语 - 中译英打字练习，把英语用出来",
  description:
    "看中文、敲英文，把「认识」练成「能用出来」。700+ 门课程、间隔重复复习、点词详情与 AI 句子讲解，每门课都可免费试学，首期优惠 ¥29 起。",
}

// 会员权益不再各写一份：统一取自 lib/membership-benefits（唯一事实源）。
// 改版前首页与价格页各写了一套，于是同一个功能在两边说法不同、且都含有
// 代码里并不存在的条目（听说读写全覆盖 / 自定义上传 / 报告导出 / 会员徽章）。
const proMemberFeatures = PRO_BENEFITS.map((b) => b.claim)

// 终身会员只讲**学习**权益。2026-09-29 合规改造后推广权益不再与付费档绑定
// （见 lib/membership-benefits 的 PROMOTER_BENEFITS），所以这里不能再用
// 任何含佣金/推广/赚钱的文案。
const lifetimeFeatures = LIFETIME_BENEFITS.map((b) => b.claim)

// 价格与「首期/续费」措辞一律取自 lib/pricing，不在页面里写死数字 ——
// 首页与价格页必须显示同一组数字和同一套说法，否则就是又一次"两边各写一份"。
function planOf(key: string) {
  const plan = findPlan(key)
  if (!plan) throw new Error(`未定义的会员档位: ${key}`)
  return plan
}
const planPrice = (key: string) => formatYuan(planOf(key).firstAmount)
const planOriginalPrice = (key: string) => formatYuan(planOf(key).standardAmount)

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
          &middot; 中译英打字练习 + AI 句子讲解 &middot;
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
        <p className="mt-6 text-[13px] text-muted-foreground flex items-center gap-2">
          <span className="flex -space-x-1.5">
            {/*
              头像走 next/image，**刻意不加 priority**。

              为什么必须改：这 4 张图源文件是 1000×1000、每张 80~112KB、合计 384KB，
              而这里只显示 20×20 CSS px —— 像素量是需要的约 2500 倍。原先用普通 <img>，
              移动网络首屏要白白拉这 384KB。交给 next/image 后由 Next 按 40×40（2 倍图）
              下发 AVIF/WebP，每张降到几 KB。

              不加 priority 的连带好处：React 19 会给服务端渲染的 <img> 自动加
              `<link rel="preload" as="image">`，而 Chrome 会因"预加载后几秒内没被用掉"
              报警告（那批 16 条警告里就有这 4 张）。next/image 不带 priority 时不发 preload，
              警告一并消失。这些图本来就是装饰性的，不值得抢占首屏带宽。
            */}
            {["avatar1.jpeg", "avatar2.jpeg", "avatar3.jpeg", "avatar4.jpeg"].map((file) => (
              <span
                key={file}
                className="inline-flex items-center justify-center h-5 w-5 rounded-full ring-1 ring-background overflow-hidden"
              >
                <Image
                  src={`/images/${file}`}
                  alt=""
                  width={40}
                  height={40}
                  className="h-full w-full object-cover"
                />
              </span>
            ))}
          </span>
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
              中译英逐词打字，即时判分反馈。不需要死记硬背，真实使用才是最好的记忆。700+ 门课程资源，让每次练习都有收获。
            </p>

            <ul className="flex flex-col gap-3">
              {[
                "即时判分，打完即知对错",
                "700+ 门课程资源",
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
              {/* 课程数按「已发布」口径写（实测 762 门）。取 700+ 而不是精确值：
                  数字只会随内容增长，向下取整不会变成假宣称；改版前写的是
                  「上千套」「1000+」，与库里实际数量不符。 */}
              <p className="text-[36px] font-bold text-card-foreground">700+</p>
              <p className="text-sm text-muted-foreground leading-relaxed">
                学习课程资源，覆盖生活、职场、旅行
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
                  desc: "掌握后自动移除复习队列",
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
                  真正已掌握自动出队
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
              Layer 3 &middot; AI 句子讲解
            </span>

            <h2 className="text-[42px] font-bold text-foreground leading-[1.2]">
              不懂就问 AI
              <br />
              每个句子讲透
            </h2>

            <p className="text-base text-muted-foreground leading-[1.7]">
              点一个词就能看释义与音标，整句读不懂时唤出 AI 讲解：语法结构、用词习惯逐条说清。难点随手记进生词本，之后复习自然会再遇到。
            </p>

            <ul className="flex flex-col gap-3">
              {[
                "点词详情 · 释义 / 音标 / 词性",
                "AI 句子讲解 · 语法与用词逐条拆解",
                "生词本与笔记 · 难点随手记下",
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
                  AI 句子讲解
                </span>
              </div>

              <div className="p-5 flex flex-col gap-3.5">
                <span className="text-[13px] text-muted-foreground">
                  点一个词看释义，或整句唤出讲解：
                </span>

                <div className="rounded-lg bg-background p-4 flex flex-col gap-2.5">
                  <p className="text-sm text-foreground leading-relaxed">
                    她每天步行去学校。
                    <br />
                    She walks to school every day.
                  </p>

                  <div className="flex flex-col gap-2">
                    <div className="rounded-md bg-card border border-border px-3.5 py-2">
                      <span className="text-[13px] font-semibold text-foreground">
                        walks
                      </span>
                      <span className="ml-2 text-[12px] text-muted-foreground">
                        步行 · 第三人称单数
                      </span>
                    </div>

                    <div className="rounded-md bg-card border border-border px-3.5 py-2">
                      <span className="text-[13px] font-semibold text-foreground">
                        every day
                      </span>
                      <span className="ml-2 text-[12px] text-muted-foreground">
                        时间状语 · 一般现在时标志
                      </span>
                    </div>
                  </div>

                  <p className="text-[12px] text-muted-foreground leading-relaxed">
                    主语是第三人称单数，谓语要用 walks，不能写成 walk。
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════
          Section 5: Testimonials
          ════════════════════════════════════════ */}
      <section id="testimonials" className="bg-muted px-5 xl:px-20 py-20 xl:py-24">
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
              按需选择适合你的方案，新用户首次购买享首期优惠
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 w-full">
            <PricingCard
              name={planOf("monthly").label}
              description={planPriceNote("monthly")}
              price={planPrice("monthly")}
              period={planPeriodSuffix("monthly")}
              originalPrice={planOriginalPrice("monthly")}
              saveBadge={planSaveNote("monthly")}
              features={proMemberFeatures}
              ctaText="立即订阅"
              ctaHref="/login"
              variant="neutral"
            />
            <PricingCard
              name={planOf("quarterly").label}
              description={planPriceNote("quarterly")}
              price={planPrice("quarterly")}
              period={planPeriodSuffix("quarterly")}
              originalPrice={planOriginalPrice("quarterly")}
              saveBadge={planSaveNote("quarterly")}
              features={proMemberFeatures}
              ctaText="立即订阅"
              ctaHref="/login"
              variant="neutral"
            />
            <PricingCard
              name={planOf("yearly").label}
              description={planPriceNote("yearly")}
              price={planPrice("yearly")}
              period={planPeriodSuffix("yearly")}
              originalPrice={planOriginalPrice("yearly")}
              subPeriod={`≈ ${formatYuan(Math.round(planOf("yearly").firstAmount / 12))}/月`}
              features={proMemberFeatures}
              ctaText="立即订阅"
              ctaHref="/login"
              variant="emphasized"
              badge="推荐"
              saveBadge={planSaveNote("yearly")}
            />
            <PricingCard
              name={planOf("partner").label}
              description={planPriceNote("partner")}
              price={planPrice("partner")}
              period={planPeriodSuffix("partner")}
              originalPrice={planOriginalPrice("partner")}
              saveBadge={planSaveNote("partner")}
              features={lifetimeFeatures}
              ctaText="了解终身会员"
              ctaHref="/login?redirect=/home/membership"
              variant="prominent"
              badge="终身"
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
