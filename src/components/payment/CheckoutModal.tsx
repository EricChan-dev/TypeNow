"use client"

import { useEffect, useState, useRef, useCallback } from "react"
import { X, Clock, Sparkles } from "lucide-react"
import QRCode from "qrcode"
import { cn } from "@/lib/utils"
import { trackSubscribeSuccess } from "@/lib/analytics"

interface CheckoutModalProps {
  plan: "monthly" | "yearly"
  onClose: () => void
  onSuccess: (plan: string) => void
}

export function CheckoutModal({ plan, onClose, onSuccess }: CheckoutModalProps) {
  const [step, setStep] = useState<"loading" | "ready" | "paid" | "expired" | "error">("loading")
  const [qrDataUrl, setQrDataUrl] = useState<string>("")
  const [orderInfo, setOrderInfo] = useState<{
    out_trade_no: string
    amount: number
  } | null>(null)
  const [countdown, setCountdown] = useState(120) // 2 minutes
  const [errorMsg, setErrorMsg] = useState("")
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
    if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null }
  }, [])

  const createOrder = useCallback(async () => {
    setStep("loading")
    setErrorMsg("")
    try {
      const res = await fetch("/api/payment/create-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "创建订单失败")

      const qrData = await QRCode.toDataURL(data.code_url, {
        width: 220,
        margin: 2,
        color: { dark: "#000000", light: "#ffffff" },
      })
      setQrDataUrl(qrData)
      setOrderInfo({ out_trade_no: data.out_trade_no, amount: data.amount })
      setStep("ready")
      setCountdown(120)
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "创建订单失败")
      setStep("error")
    }
  }, [plan])

  // Start polling when order is ready
  useEffect(() => {
    if (step !== "ready" || !orderInfo) return

    // Countdown timer
    countdownRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          stopPolling()
          setStep("expired")
          return 0
        }
        return prev - 1
      })
    }, 1000)

    // Poll order status every 3 seconds
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(
          `/api/payment/order-status?out_trade_no=${orderInfo.out_trade_no}`
        )
        const data = await res.json()
        if (data.status === "paid") {
          stopPolling()
          setStep("paid")
          trackSubscribeSuccess(plan, orderInfo.amount)
          setTimeout(() => onSuccess(plan), 1500)
        }
      } catch {
        // Silently retry on next poll
      }
    }, 3000)

    return stopPolling
  }, [step, orderInfo, stopPolling, onSuccess])

  // Create order on mount
  useEffect(() => { createOrder() }, [createOrder])

  const planName = plan === "monthly" ? "月度会员" : "年度会员"
  const amountYuan = plan === "monthly" ? "29.00" : "199.00"
  const minutes = Math.floor(countdown / 60)
  const seconds = countdown % 60

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="relative w-full max-w-[400px] rounded-2xl bg-card border border-border p-8 shadow-2xl flex flex-col items-center gap-6">
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          aria-label="关闭"
        >
          <X className="h-5 w-5" />
        </button>

        {/* Header */}
        <div className="text-center">
          <h3 className="text-lg font-bold text-card-foreground">
            订阅 {planName}
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            请使用微信扫描二维码完成支付
          </p>
        </div>

        {/* QR Code area */}
        <div className="relative flex items-center justify-center">
          {step === "loading" && (
            <div className="h-[220px] w-[220px] rounded-xl bg-muted animate-pulse flex items-center justify-center">
              <Sparkles className="h-8 w-8 text-muted-foreground animate-spin" />
            </div>
          )}

          {step === "ready" && qrDataUrl && (
            <div className="rounded-xl border-2 border-border p-2 bg-white">
              <img
                src={qrDataUrl}
                alt="微信支付二维码"
                className="h-[200px] w-[200px]"
              />
            </div>
          )}

          {step === "paid" && (
            <div className="h-[220px] w-[220px] rounded-xl bg-success/10 border-2 border-success flex flex-col items-center justify-center gap-3">
              <div className="h-14 w-14 rounded-full bg-success flex items-center justify-center">
                <svg className="h-8 w-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <span className="text-sm font-semibold text-success">支付成功</span>
            </div>
          )}

          {step === "expired" && (
            <div className="h-[220px] w-[220px] rounded-xl bg-muted border-2 border-border flex flex-col items-center justify-center gap-4">
              <Clock className="h-10 w-10 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">二维码已过期</span>
              <button
                onClick={createOrder}
                className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90"
              >
                重新获取
              </button>
            </div>
          )}

          {step === "error" && (
            <div className="h-[220px] w-[220px] rounded-xl bg-muted border-2 border-border flex flex-col items-center justify-center gap-4 px-4">
              <span className="text-sm text-muted-foreground text-center">{errorMsg}</span>
              <button
                onClick={createOrder}
                className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90"
              >
                重试
              </button>
            </div>
          )}
        </div>

        {/* Price + countdown */}
        {step === "ready" && (
          <>
            <div className="text-center">
              <p className="text-2xl font-extrabold text-card-foreground">
                ¥{amountYuan}
              </p>
              <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground mt-1">
                <Clock className="h-3 w-3" />
                二维码有效期 {minutes}:{String(seconds).padStart(2, "0")}
              </p>
            </div>

            <p className="text-xs text-muted-foreground text-center leading-relaxed">
              支付成功后自动开通会员，可在设置中管理订阅
            </p>
          </>
        )}
        </div>

        {/* Backdrop click to close */}
        <div className="absolute inset-0 -z-10" onClick={onClose} />
      </div>
    )
}
