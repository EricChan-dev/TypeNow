"use client"

import { useEffect, useState, useRef, useCallback } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import { Clock, Sparkles, ArrowLeft, CheckCircle2 } from "lucide-react"
import QRCode from "qrcode"
import Link from "next/link"

const PLAN_LABELS: Record<string, string> = {
  partner: "合伙人终身会员",
  monthly: "月度会员",
  yearly: "年度会员",
}

const PLAN_AMOUNTS: Record<string, string> = {
  partner: "399.00",
  monthly: "29.00",
  yearly: "199.00",
}

export default function CheckoutPage() {
  const params = useSearchParams()
  const router = useRouter()

  const outTradeNo = params.get("out_trade_no") ?? ""
  const plan = params.get("plan") ?? "partner"
  const codeUrl = params.get("code_url") ?? ""

  const [step, setStep] = useState<"loading" | "ready" | "paid" | "expired" | "error">("loading")
  const [qrDataUrl, setQrDataUrl] = useState("")
  const [countdown, setCountdown] = useState(120)
  const [errorMsg, setErrorMsg] = useState("")

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
    if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null }
  }, [])

  // Generate QR from code_url in search param
  useEffect(() => {
    if (!codeUrl) {
      setErrorMsg("缺少支付参数，请返回重试")
      setStep("error")
      return
    }
    QRCode.toDataURL(codeUrl, {
      width: 240,
      margin: 2,
      color: { dark: "#000000", light: "#ffffff" },
    })
      .then((url) => {
        setQrDataUrl(url)
        setStep("ready")
      })
      .catch(() => {
        setErrorMsg("二维码生成失败，请返回重试")
        setStep("error")
      })
  }, [codeUrl])

  // Start polling + countdown when ready
  useEffect(() => {
    if (step !== "ready" || !outTradeNo) return

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

    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/payment/order-status?out_trade_no=${outTradeNo}`)
        const data = await res.json()
        if (data.status === "paid") {
          stopPolling()
          setStep("paid")
          setTimeout(() => {
            router.push(plan === "partner" ? "/home/partner" : "/home")
          }, 2000)
        }
      } catch {
        // silently retry
      }
    }, 3000)

    return stopPolling
  }, [step, outTradeNo, plan, router, stopPolling])

  const minutes = Math.floor(countdown / 60)
  const seconds = countdown % 60
  const planLabel = PLAN_LABELS[plan] ?? "会员"
  const amountYuan = PLAN_AMOUNTS[plan] ?? "—"

  return (
    <div className="min-h-full bg-black flex flex-col items-center justify-center px-4 py-10">
      {/* Back link */}
      <div className="w-full max-w-[420px] mb-4">
        <Link
          href={plan === "partner" ? "/home/partner" : "/home/store"}
          className="inline-flex items-center gap-1.5 text-white/40 text-sm hover:text-white/70 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          返回
        </Link>
      </div>

      <div className="w-full max-w-[420px] rounded-3xl border border-white/10 bg-white/[0.03] backdrop-blur-sm p-8 flex flex-col items-center gap-6">
        {/* Header */}
        <div className="text-center">
          <div className="inline-flex items-center gap-2 rounded-full bg-amber-500/10 border border-amber-500/20 px-3 py-1 text-xs font-medium text-amber-400 mb-3">
            {planLabel}
          </div>
          <h1 className="text-xl font-bold text-white">微信扫码完成支付</h1>
          <p className="text-white/40 text-sm mt-1">支付成功后自动开通，无需刷新</p>
        </div>

        {/* QR Area */}
        <div className="relative flex items-center justify-center">
          {step === "loading" && (
            <div className="h-[240px] w-[240px] rounded-2xl bg-white/5 border border-white/10 animate-pulse flex items-center justify-center">
              <Sparkles className="h-8 w-8 text-white/20 animate-spin" />
            </div>
          )}

          {step === "ready" && qrDataUrl && (
            <div className="rounded-2xl border border-white/20 p-3 bg-white shadow-xl shadow-black/30">
              <img src={qrDataUrl} alt="微信支付二维码" className="h-[216px] w-[216px] block" />
            </div>
          )}

          {step === "paid" && (
            <div className="h-[240px] w-[240px] rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex flex-col items-center justify-center gap-4">
              <CheckCircle2 className="h-16 w-16 text-emerald-400" />
              <div className="text-center">
                <p className="text-white font-bold">支付成功！</p>
                <p className="text-white/50 text-xs mt-1">正在跳转…</p>
              </div>
            </div>
          )}

          {step === "expired" && (
            <div className="h-[240px] w-[240px] rounded-2xl bg-white/5 border border-white/10 flex flex-col items-center justify-center gap-4">
              <Clock className="h-10 w-10 text-white/30" />
              <span className="text-white/40 text-sm">二维码已过期</span>
              <Link
                href={plan === "partner" ? "/home/partner" : "/home/store"}
                className="px-4 py-2 rounded-xl bg-white/10 text-white text-sm font-medium hover:bg-white/15 transition-colors"
              >
                重新获取
              </Link>
            </div>
          )}

          {step === "error" && (
            <div className="h-[240px] w-[240px] rounded-2xl bg-white/5 border border-white/10 flex flex-col items-center justify-center gap-4 px-6">
              <p className="text-white/40 text-sm text-center">{errorMsg}</p>
              <Link
                href={plan === "partner" ? "/home/partner" : "/home/store"}
                className="px-4 py-2 rounded-xl bg-white/10 text-white text-sm font-medium hover:bg-white/15 transition-colors"
              >
                返回重试
              </Link>
            </div>
          )}
        </div>

        {/* Price + timer */}
        {step === "ready" && (
          <div className="text-center space-y-1.5 w-full">
            <p className="text-3xl font-extrabold text-white">¥{amountYuan}</p>
            <p className="flex items-center justify-center gap-1.5 text-xs text-white/35">
              <Clock className="h-3 w-3" />
              二维码有效期 {minutes}:{String(seconds).padStart(2, "0")}
            </p>
          </div>
        )}

        {/* Tips */}
        {(step === "ready" || step === "loading") && (
          <div className="w-full rounded-2xl bg-white/[0.04] border border-white/8 px-4 py-3 space-y-1.5">
            <p className="text-white/30 text-[11px] text-center leading-relaxed">
              打开微信 → 扫一扫 → 完成支付
            </p>
            <p className="text-white/20 text-[11px] text-center">
              付款成功后页面自动跳转，请勿关闭此页面
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
