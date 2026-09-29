"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { PricingCard } from "@/components/pricing/PricingCard"
import { CheckoutModal } from "@/components/payment/CheckoutModal"
import { trackSubscribeClick } from "@/lib/analytics"
import { LIFETIME_BENEFITS, PRO_BENEFITS } from "@/lib/membership-benefits"
import {
  PLANS,
  formatYuan,
  planPeriodSuffix,
  planPriceNote,
  planSaveNote,
  type PlanKey,
  type PlanSpec,
} from "@/lib/pricing"

// 权益清单取自唯一事实源（lib/membership-benefits），不在组件里另写一份。
// 改版前这里是硬编码的 7 条，其中 4 条在代码里根本不存在、
// 另 3 条则是"人人都有"却被当成会员专属 —— 与价格页对比表、首页又各不相同。
const proFeatures = PRO_BENEFITS.map((b) => b.claim)

// 终身会员只有**学习**权益。2026-09-29 合规改造后推广权益与付费档完全解绑
// （见 lib/membership-benefits 的 PROMOTER_BENEFITS 与 COMPARISON_NOTE），
// 所以这张卡上不能出现任何佣金/推广/赚钱文案。
const lifetimeFeatures = LIFETIME_BENEFITS.map((b) => b.claim)

/** 视觉强调：只有年卡与终身卡带 badge。 */
const EMPHASIS: Record<PlanKey, { variant: "neutral" | "emphasized" | "prominent"; badge?: string }> = {
  monthly: { variant: "neutral" },
  quarterly: { variant: "neutral" },
  yearly: { variant: "emphasized", badge: "推荐" },
  partner: { variant: "prominent", badge: "终身" },
}

export function PricingClient() {
  const router = useRouter()
  const [selectedPlan, setSelectedPlan] = useState<PlanKey | null>(null)
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [checkingAuth, setCheckingAuth] = useState(true)

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((data) => setIsLoggedIn(!!data?.user))
      .catch(() => setIsLoggedIn(false))
      .finally(() => setCheckingAuth(false))
  }, [])

  function handleCheckout(plan: PlanKey) {
    trackSubscribeClick(plan, "pricing")
    if (!isLoggedIn) {
      router.push("/login?redirect=/pricing")
      return
    }
    // 终身档不走扫码下单：它没有续费周期，购买入口在会员中心。
    // 这里也不再指向 /home/partner —— 那个页面现在是**免费**的推广中心，
    // 与「买终身会员」是两件事（2026-09-29 合规改造的核心）。
    if (plan === "partner") {
      router.push("/home/membership")
      return
    }
    setSelectedPlan(plan)
  }

  function handleSuccess(plan: string) {
    setSelectedPlan(null)
    router.push(`/home?payment_success=${plan}`)
  }

  // 卡片文案全部由档位定义推导，页面里不写死任何价格或「/月」后缀。
  function cardProps(plan: PlanSpec) {
    return {
      name: plan.label,
      description: planPriceNote(plan.key),
      price: formatYuan(plan.firstAmount),
      period: planPeriodSuffix(plan.key),
      originalPrice: formatYuan(plan.standardAmount),
      features: plan.lifetime ? lifetimeFeatures : proFeatures,
      saveBadge: planSaveNote(plan.key),
      ...EMPHASIS[plan.key],
    }
  }

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 w-full">
        {PLANS.map((plan) => (
          <PricingCard
            key={plan.key}
            {...cardProps(plan)}
            ctaText={plan.lifetime ? "了解终身会员" : "立即订阅"}
            ctaHref="/login"
            onCheckout={() => handleCheckout(plan.key)}
          />
        ))}
      </div>

      {selectedPlan && (
        <CheckoutModal
          plan={selectedPlan}
          onClose={() => setSelectedPlan(null)}
          onSuccess={handleSuccess}
        />
      )}
    </>
  )
}
