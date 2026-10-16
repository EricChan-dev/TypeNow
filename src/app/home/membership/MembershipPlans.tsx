"use client"

import { useState } from "react"
import Link from "next/link"
import {
  BookOpen,
  Check,
  ChevronRight,
  Clock,
  Flame,
  Gem,
  Mic,
  Smile,
  X,
  type LucideIcon,
} from "lucide-react"
import { CheckoutModal } from "@/components/payment/CheckoutModal"
import { PartnerCheckoutButton } from "./PartnerCheckoutButton"
import { findPlan, planPeriodSuffix, PLANS, formatYuan, type PlanKey, type PlanSpec } from "@/lib/pricing"
import { trackSubscribeClick } from "@/lib/analytics"
import { ATTRIBUTION_WINDOW_DAYS, COMMISSION_RATE } from "@/lib/partner-rules"
import {
  FREE_AI_ANALYZE_PER_DAY,
  FREE_AI_CHAT_PER_DAY,
  FREE_PRONUNCIATION_PER_DAY,
  MEMBER_DAILY_DIAMONDS,
  PRO_AI_ANALYZE_PER_DAY,
  PRO_AI_CHAT_PER_DAY,
  PRO_PRONUNCIATION_PER_DAY,
} from "@/lib/membership-benefits"
import { FREE_TRIAL_SENTENCES } from "@/lib/free-trial"

/**
 * 三张套餐卡。
 *
 * 为什么必须是客户端组件：畅学版卡上有**月/季/年切换 Tab**，切一次要同时改
 * 大号价格、划线原价、立省金额、每日均价和下单按钮携带的档位 —— 这些状态
 * 只能活在客户端。页面其余部分（对比表、服务承诺、订阅记录）仍是服务端渲染。
 *
 * ⚠️ 所有数字都从事实源取（`lib/pricing` / `lib/membership-benefits` /
 * `lib/partner-rules`），本文件里**不出现任何写死的价格或额度**。
 * 改价时若把数字散写在 data-* 属性或多张卡里，要同时改多处，
 * 那正是 `lib/membership-benefits` 文件头记录过的「4 处各写一份然后漂移」的坑。
 */

/** 数字取自事实源，不在文案里写死。 */
const FIRST_PCT = `${COMMISSION_RATE.first * 100}%`
const RENEW_PCT = `${COMMISSION_RATE.renewal * 100}%`

interface Feature {
  Icon: LucideIcon
  text: string
 /** `ai` = 暖黄高亮；`underline` = 划线灰字（无此权限）。 */
  tone?: "ai" | "underline"
}

/** 免费版权益：额度与「人人都有」的清单全部来自事实源。 */
const FREE_FEATURES: readonly Feature[] = [
  { Icon: Clock, text: `每课试学 ${FREE_TRIAL_SENTENCES} 句` },
  { Icon: BookOpen, text: "背单词与生词本全面开放" },
  { Icon: Mic, text: `跟读评分每天 ${FREE_PRONUNCIATION_PER_DAY} 次`, tone: "ai" },
  { Icon: Flame, text: `AI 私教助手每天 ${FREE_AI_CHAT_PER_DAY} 次`, tone: "ai" },
  { Icon: Flame, text: `AI 句子讲解每天 ${FREE_AI_ANALYZE_PER_DAY} 次`, tone: "ai" },
  { Icon: X, text: "无推广返利权限", tone: "underline" },
]

/** 畅学版权益：即 PRO_BENEFITS 的用户面表述。 */
const PRO_FEATURES: readonly Feature[] = [
  { Icon: Check, text: "解锁全部课程完整内容" },
  { Icon: Check, text: "打字练习不限次" },
  { Icon: Check, text: `跟读评分每天 ${PRO_PRONUNCIATION_PER_DAY} 次` },
  { Icon: Flame, text: `AI 私教助手每天 ${PRO_AI_CHAT_PER_DAY} 次`, tone: "ai" },
  { Icon: Flame, text: `AI 句子讲解每天 ${PRO_AI_ANALYZE_PER_DAY} 次`, tone: "ai" },
  { Icon: Gem, text: `会员每天赠送 ${MEMBER_DAILY_DIAMONDS} 颗钻石`, tone: "ai" },
  { Icon: X, text: "无推广返利权限", tone: "underline" },
]

/** 合伙人版权益：终身学习权益 + 推广权益（2026-10-10 起重新绑定）。 */
const PARTNER_FEATURES: readonly Feature[] = [
  { Icon: Check, text: "含畅学版全部学习权益" },
  { Icon: Check, text: "一次买断，终身有效，不再续费" },
  { Icon: ChevronRight, text: "专属邀请链接 / 二维码 / 海报" },
  { Icon: ChevronRight, text: `首单 ${FIRST_PCT} · 续费 ${RENEW_PCT}` },
  { Icon: ChevronRight, text: "收益全额提现至微信零钱" },
]

/** 畅学版三个档位（月/季/年），顺序与 Tab 一致。 */
const PRO_TIERS = PLANS.filter((p) => !p.lifetime)

/**
 * 每天均价（元，两位小数）。
 *
 * 用 `durationDays` 而不是 `months * 30`：年卡是 365 天，用 30 天/月硬乘会得到
 * 360，让「每天均价」虚高一截（见 `lib/pricing` 里 durationDays 的说明）。
 */
function dailyPrice(plan: PlanSpec): number {
  if (!plan.durationDays) return 0
  return Math.round((plan.firstAmount / 100 / plan.durationDays) * 100) / 100
}

/** 把 `formatYuan` 的结果拆成「符号」与「数字」，好让两者用不同字号排版。 */
function yuanParts(cents: number): { symbol: string; value: string } {
  const s = formatYuan(cents)
  return { symbol: s.slice(0, 1), value: s.slice(1) }
}

/** 一张权益清单（三张卡共用同一套逐行等高规则，横向必须对齐）。 */
function FeatureList({ features }: { features: readonly Feature[] }) {
  return (
    <p>
      {features.map(({ Icon, text, tone }) => (
        <label key={text} className={tone}>
          <Icon />
          <span>{text}</span>
        </label>
      ))}
    </p>
  )
}

export function MembershipPlans({
  memberTier,
  isPro,
  isPartner,
}: {
  memberTier: string
  isPro: boolean
  isPartner: boolean
}) {
  // 默认落在年卡：它既是我们的历史默认档，也是每天均价最低的一档。
  const [tierKey, setTierKey] = useState<PlanKey>("yearly")
  const [checkoutPlan, setCheckoutPlan] = useState<PlanKey | null>(null)

  const tier = findPlan(tierKey) ?? PRO_TIERS[PRO_TIERS.length - 1]
  const tierParts = yuanParts(tier.firstAmount)
  const standardParts = yuanParts(tier.standardAmount)
  const savings = Math.max(0, (tier.standardAmount - tier.firstAmount) / 100)

  const isFreeCurrent = memberTier === "free"
  const isProCurrent = isPro && !isPartner

  function handleProCheckout() {
    trackSubscribeClick(tierKey, "membership")
    setCheckoutPlan(tierKey)
  }

  return (
    <>
      <div className="version membership-plan-grid">
        {/* ── 免费版 ──────────────────────────────────────────────────────── */}
        <div className="basic free-plan-card">
          <div className="plan-card-head">
            <h3>
              <label>免费版</label>
              <small>适合轻度学习或体验产品</small>
            </h3>
            {isFreeCurrent && <span className="plan-tone plan-tone-current">当前方案</span>}
          </div>

          {/* 免费版没有档位，但保留一条透明占位条，让三张卡的价格区从同一条
              水平线开始 —— 否则免费版的价格会比另外两张高出一整条 Tab。 */}
          <div className="plan-duration-tabs is-placeholder" aria-hidden="true">
            <button type="button" className="plan-tab active" tabIndex={-1}>
              月卡
            </button>
          </div>

          <div className="marketing-price-block">
            <div className="pro-price-savings" style={{ visibility: "hidden" }}>
              <span style={{ fontSize: 14 }}>日常价</span>
            </div>
            <div className="pro-price-wrapper">
              <span className="pro-price-currency">￥</span>
              <span className="pro-price-value">0</span>
              <span className="pro-duration-label">/永久</span>
            </div>
            <div className="free-lifetime-badge">
              <Smile />
              基础体验，永久免费
            </div>
          </div>

          {isFreeCurrent ? (
            <span className="plan-cta">当前方案</span>
          ) : (
            <Link href="/home" className="plan-cta">
              立即开始
            </Link>
          )}

          <FeatureList features={FREE_FEATURES} />
        </div>

        {/* ── 畅学版（可切档）─────────────────────────────────────────────── */}
        <div className="Pro member-card pro-plan-card premium-plan" data-member="pro">
          <div className="plan-card-head">
            <h3>
              <label>
                畅学版
                <Gem />
              </label>
              <small>不限时长，适合深度学习</small>
            </h3>
            {isProCurrent ? (
              <span className="plan-tone plan-tone-current">当前方案</span>
            ) : (
              <span className="plan-tone plan-tone-hot">推荐</span>
            )}
          </div>

          <div className="plan-duration-tabs" role="tablist" aria-label="畅学版时长">
            {PRO_TIERS.map((plan) => (
              <button
                key={plan.key}
                type="button"
                role="tab"
                aria-selected={plan.key === tierKey}
                className={`plan-tab${plan.key === tierKey ? " active" : ""}`}
                onClick={() => setTierKey(plan.key)}
              >
                {(planPeriodSuffix(plan.key) || "").replace("/", "")}卡
              </button>
            ))}
          </div>

          <div className="marketing-price-block">
            <div className="pro-price-savings" style={{ visibility: savings > 0 ? "visible" : "hidden" }}>
              <del className="original-price">
                日常价 ￥{standardParts.value}
              </del>
              {savings > 0 && (
                <span className="saving-badge">
                  立省 ￥{savings.toFixed(2).replace(/\.00$/, "")}
                </span>
              )}
            </div>
            <div className="pro-price-wrapper">
              <span className="pro-price-currency">￥</span>
              <span className="pro-price-value">{tierParts.value}</span>
              <span className="pro-duration-label">{planPeriodSuffix(tier.key)}</span>
            </div>
            <div className="pro-daily-price">
              <Flame />
              相当于每天仅 ¥{dailyPrice(tier).toFixed(2)}
            </div>
          </div>

          {isProCurrent ? (
            <span className="plan-cta">当前方案</span>
          ) : (
            <button type="button" className="plan-cta" onClick={handleProCheckout}>
              升级畅学版
            </button>
          )}

          <FeatureList features={PRO_FEATURES} />
        </div>

        {/* ── 合伙人版 ────────────────────────────────────────────────────── */}
        <div className="Pro member-card partner-plan-card" data-member="partner">
          <div className="plan-card-head">
            <h3>
              <label>
                合伙人版
                <Gem />
              </label>
              <small>终身畅享 + 推广分佣</small>
            </h3>
            {isPartner && <span className="plan-tone plan-tone-current">当前方案</span>}
          </div>

          <div className="plan-duration-tabs is-placeholder" aria-hidden="true">
            <button type="button" className="plan-tab active" tabIndex={-1}>
              月卡
            </button>
          </div>

          <div className="marketing-price-block">
            {(() => {
              const partner = findPlan("partner")
              if (!partner) return null
              const first = yuanParts(partner.firstAmount)
              const standard = yuanParts(partner.standardAmount)
              return (
                <>
                  <div className="pro-price-savings">
                    <del className="original-price">原价 ￥{standard.value}</del>
                  </div>
                  <div className="pro-price-wrapper">
                    <span className="pro-price-currency">￥</span>
                    <span className="pro-price-value">{first.value}</span>
                    <span className="pro-duration-label">/终身</span>
                  </div>
                  <div className="partner-lifetime-badge">
                    <Gem />
                    一次付费，终身有效
                  </div>
                </>
              )
            })()}
          </div>

          {isPartner ? (
            /* 已开通合伙人版：这里原本是个不可点击的「当前方案」死标签。
               改成进入合伙人计划页的入口 —— 身份已经由卡头右上角的
               `.plan-tone-current` 胶囊表达了，CTA 位置空着不如给一条去路。
               用 <Link> 而不是 window.location，浏览器前进/后退正常；
               目标页顶部另有显式的「返回会员中心」。 */
            <Link href="/home/partner" className="plan-cta">
              了解合伙人计划
            </Link>
          ) : (
            /* 合伙人版必须在这里直接下单：价格页的 handleCheckout() 对 partner
               会把人送回本页（见 PricingClient.tsx:67），所以本页是唯一购买入口。
               2026-10-10 的反向改动漏了这一环，两页曾互指成闭环。 */
            <PartnerCheckoutButton className="plan-cta">立即开通合伙人版</PartnerCheckoutButton>
          )}

          <FeatureList features={PARTNER_FEATURES} />

          {/* 分佣微卡：比例取自 lib/partner-rules，两行都按「被推荐人买哪一档」
 表达。 */}
          <div className="partner-commission-box">
            <div className="pcb-header">
              <div className="pcb-title">
                <Gem />
                <span>专属推广分佣特权</span>
              </div>
              <span className="pcb-badge">{ATTRIBUTION_WINDOW_DAYS} 天归因</span>
            </div>
            <div className="pcb-body">
              <div className="pcb-row">
                <span className="pcb-row-target">
                  <ChevronRight />
                  推荐畅学版
                </span>
                <span className="pcb-row-rate">
                  首单 <b>{FIRST_PCT}</b> · 续费 <b>{RENEW_PCT}</b>
                </span>
              </div>
              <div className="pcb-row">
                <span className="pcb-row-target">
                  <ChevronRight />
                  推荐合伙人版
                </span>
                <span className="pcb-row-rate">
                  享一次性 <b>{FIRST_PCT}</b> 分佣
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {checkoutPlan && (
        <CheckoutModal
          plan={checkoutPlan}
          onClose={() => setCheckoutPlan(null)}
          onSuccess={() => {
            setCheckoutPlan(null)
            window.location.assign(`/home/membership?payment_success=${checkoutPlan}`)
          }}
        />
      )}
    </>
  )
}
