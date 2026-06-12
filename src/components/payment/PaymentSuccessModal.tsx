"use client"

import { useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { CheckCircle2, PartyPopper } from "lucide-react"

const PLAN_NAMES: Record<string, string> = {
  monthly: "月度会员",
  yearly: "年度会员",
  partner: "合伙人会员",
}

export function PaymentSuccessModal() {
  const searchParams = useSearchParams()
  const [visible, setVisible] = useState(false)

  const paymentPlan = searchParams.get("payment_success")

  useEffect(() => {
    if (paymentPlan) {
      setVisible(true)
    }
  }, [paymentPlan])

  if (!visible || !paymentPlan) return null

  const planName = PLAN_NAMES[paymentPlan] || "会员"

  function handleClose() {
    setVisible(false)
    const params = new URLSearchParams(window.location.search)
    params.delete("payment_success")
    const newSearch = params.toString()
    window.history.replaceState(null, "", window.location.pathname + (newSearch ? `?${newSearch}` : ""))
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
      <div className="rounded-2xl bg-card border border-border p-8 text-center max-w-sm mx-4 shadow-2xl">
        <div className="flex justify-center mb-4">
          <div className="relative">
            <div className="absolute inset-0 rounded-full bg-success/20 animate-ping" />
            <div className="relative flex items-center justify-center h-16 w-16 rounded-full bg-success/10">
              <CheckCircle2 className="h-9 w-9 text-success" />
            </div>
          </div>
        </div>

        <div className="flex items-center justify-center gap-2 mb-2">
          <PartyPopper className="h-5 w-5 text-amber-400" />
          <h3 className="text-xl font-bold text-card-foreground">支付成功</h3>
          <PartyPopper className="h-5 w-5 text-amber-400" />
        </div>

        <p className="text-sm text-muted-foreground mb-6">
          恭喜你成为 TypeNow{planName}，所有功能已全部解锁！
        </p>

        <button
          onClick={handleClose}
          className="inline-flex items-center justify-center w-full rounded-xl bg-primary px-6 py-3 text-[15px] font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          开始学习
        </button>
      </div>
    </div>
  )
}
