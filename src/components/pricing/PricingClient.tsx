"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { PricingCard } from "@/components/pricing/PricingCard"
import { CheckoutModal } from "@/components/payment/CheckoutModal"
import { trackSubscribeClick } from "@/lib/analytics"

const proFeatures = [
  "多种练习模式，听说读写全覆盖",
  "AI 口语评测，音素级纠音，越练越准",
  "AI 私教助手，不懂随时问",
  "FSRS 智能复习，学了就忘不掉",
  "自定义上传内容，考题歌词都能练",
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
          description="解锁全部功能，高效提升英语能力"
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
