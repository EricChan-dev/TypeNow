"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { PricingCard } from "@/components/pricing/PricingCard"
import { CheckoutModal } from "@/components/payment/CheckoutModal"
import { trackSubscribeClick } from "@/lib/analytics"
import { PARTNER_BENEFITS, PRO_BENEFITS } from "@/lib/membership-benefits"

// 权益清单取自唯一事实源（lib/membership-benefits），不在组件里另写一份。
// 改版前这里是硬编码的 7 条，其中 4 条在代码里根本不存在、
// 另 3 条则是"人人都有"却被当成会员专属 —— 与价格页对比表、首页又各不相同。
const proFeatures = PRO_BENEFITS.map((b) => b.claim)

const partnerFeatures = PARTNER_BENEFITS.map((b) => b.claim)

export function PricingClient() {
  const router = useRouter()
  const [selectedPlan, setSelectedPlan] = useState<"monthly" | "yearly" | null>(null)
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [checkingAuth, setCheckingAuth] = useState(true)

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((data) => setIsLoggedIn(!!data?.user))
      .catch(() => setIsLoggedIn(false))
      .finally(() => setCheckingAuth(false))
  }, [])

  function handleCheckout(plan: "monthly" | "yearly") {
    trackSubscribeClick(plan, "pricing")
    if (!isLoggedIn) {
      router.push("/login?redirect=/pricing")
      return
    }
    setSelectedPlan(plan)
  }

  function handlePartner() {
    if (!isLoggedIn) {
      router.push("/login?redirect=/home/partner")
      return
    }
    router.push("/home/partner")
  }

  function handleSuccess(plan: string) {
    setSelectedPlan(null)
    router.push(`/home?payment_success=${plan}`)
  }

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full">
        <PricingCard
          name="月度会员"
          description="解锁全部课程与更高额度"
          price="¥29"
          period="/月"
          features={proFeatures}
          ctaText="立即订阅"
          ctaHref="/login"
          variant="neutral"
          onCheckout={() => handleCheckout("monthly")}
        />
        <PricingCard
          name="年度会员"
          description="最划算的选择，每天不到 6 毛钱"
          price="¥199"
          period="/年"
          originalPrice="¥348"
          subPeriod="≈ ¥16.6/月"
          features={proFeatures}
          ctaText="立即订阅"
          ctaHref="/login"
          variant="emphasized"
          badge="推荐"
          saveBadge="省 ¥149"
          onCheckout={() => handleCheckout("yearly")}
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
          onCheckout={handlePartner}
        />
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
