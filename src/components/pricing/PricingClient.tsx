"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { PricingCard } from "@/components/pricing/PricingCard"
import { CheckoutModal } from "@/components/payment/CheckoutModal"
import { createClient } from "@/lib/supabase/client"
import { trackSubscribeClick } from "@/lib/analytics"

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

export function PricingClient() {
  const router = useRouter()
  const [selectedPlan, setSelectedPlan] = useState<"monthly" | "yearly" | null>(null)
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [checkingAuth, setCheckingAuth] = useState(true)

  useEffect(() => {
    const supabase = createClient()
    if (!supabase) {
      setCheckingAuth(false)
      return
    }
    supabase.auth.getSession().then(({ data }) => {
      setIsLoggedIn(!!data.session)
      setCheckingAuth(false)
    })
  }, [])

  function handleCheckout(plan: "monthly" | "yearly") {
    trackSubscribeClick(plan, "pricing")
    if (!isLoggedIn) {
      router.push("/login?redirect=/pricing")
      return
    }
    setSelectedPlan(plan)
  }

  function handleSuccess() {
    setSelectedPlan(null)
    router.push("/home")
  }

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full">
        <PricingCard
          name="普通会员"
          description="快速上手，体验核心打字练习功能"
          price="¥0"
          period="永久免费"
          features={freeFeatures}
          ctaText="免费开始"
          ctaHref={isLoggedIn ? "/home" : "/login"}
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
          onCheckout={() => handleCheckout("monthly")}
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
          onCheckout={() => handleCheckout("yearly")}
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
