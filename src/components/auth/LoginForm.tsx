"use client"

import { useState, useCallback, useEffect, useRef } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { MessageCircle, Smartphone, QrCode, Loader2 } from "lucide-react"
import { toast } from "sonner"
import QRCode from "qrcode"
import { WeChatQRCode } from "@/components/auth/WeChatQRCode"

type LoginTab = "wechat" | "phone"

function TermsText() {
  return (
    <p className="text-center text-xs text-[#64748B] leading-relaxed">
      登录即表示同意
      <Link href="/terms" className="text-[#1E40AF] font-medium hover:underline mx-0.5">
        《用户协议》
      </Link>
      和
      <Link href="/privacy" className="text-[#1E40AF] font-medium hover:underline mx-0.5">
        《隐私政策》
      </Link>
    </p>
  )
}

const ERROR_MESSAGES: Record<string, string> = {
  invalid_callback: "微信回调参数错误，请重试",
  csrf_mismatch: "安全验证失败，请刷新页面重试",
  code_expired: "微信授权码已过期，请重新扫码",
  code_used: "微信授权码已被使用，请重新扫码",
  wechat_invalid_code: "微信授权码无效，请重新扫码",
  network_error: "微信服务连接失败，请稍后重试",
  server_error: "服务异常，请稍后重试",
  signin_failed: "登录失败，请重试",
}

export function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [activeTab, setActiveTab] = useState<LoginTab>("phone")
  const [phone, setPhone] = useState("")
  const [code, setCode] = useState("")
  const [cooldown, setCooldown] = useState(0)
  const [loading, setLoading] = useState(false)
  const [devQrDataUrl, setDevQrDataUrl] = useState<string | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const redirectTo = searchParams.get("redirect") || "/home"

  const isSupabaseConfigured =
    !!process.env.NEXT_PUBLIC_SUPABASE_URL?.startsWith("http")
  const isDevMode = !isSupabaseConfigured

  const isDevEnv = process.env.NODE_ENV === "development"

  // Generate dev login QR code
  useEffect(() => {
    if (!isDevEnv) return
    const devLoginUrl = `${window.location.origin}/api/auth/dev-login`
    QRCode.toDataURL(devLoginUrl, { width: 160, margin: 1 }).then(setDevQrDataUrl)
  }, [isDevEnv])

  // Handle error query param from WeChat callback redirects
  useEffect(() => {
    const errorParam = searchParams.get("error")
    if (errorParam) {
      // Switch to WeChat tab so user sees the QR code to retry
      if (
        [
          "code_expired",
          "code_used",
          "wechat_invalid_code",
          "csrf_mismatch",
        ].includes(errorParam)
      ) {
        setActiveTab("wechat")
      }
      const message = ERROR_MESSAGES[errorParam] || "登录失败，请重试"
      toast.error(message)
    }
  }, [searchParams])

  const handleSendCode = useCallback(async () => {
    const trimmedPhone = phone.trim()
    if (!trimmedPhone) {
      toast.error("请输入手机号")
      return
    }
    if (!/^1[3-9]\d{9}$/.test(trimmedPhone)) {
      toast.error("请输入有效的手机号")
      return
    }

    setLoading(true)
    try {
      // Dev mode without Supabase: skip HTTP request
      if (isDevMode) {
        toast.success("验证码已发送（开发模式：输入 123456）")
        startCooldown()
        return
      }

      const res = await fetch("/api/auth/send-sms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: trimmedPhone }),
      })

      const data = await res.json()

      if (!res.ok) {
        toast.error(data.error || "发送验证码失败")
        return
      }

      toast.success(data.message || "验证码已发送")
      startCooldown()
    } catch {
      toast.error("发送验证码失败，请重试")
    } finally {
      setLoading(false)
    }

    function startCooldown() {
      setCooldown(60)
      const timer = setInterval(() => {
        setCooldown((prev) => {
          if (prev <= 1) {
            clearInterval(timer)
            return 0
          }
          return prev - 1
        })
      }, 1000)
    }
  }, [phone, isDevMode])

  const handleLogin = useCallback(async () => {
    const trimmedPhone = phone.trim()
    const trimmedCode = code.trim()

    if (!trimmedPhone || !trimmedCode) {
      toast.error("请输入手机号和验证码")
      return
    }

    setLoading(true)
    try {
      // Dev mode without Supabase: accept 123456
      if (isDevMode) {
        if (trimmedCode === "123456") {
          toast.success("登录成功（开发模式）")
          router.push(redirectTo)
          router.refresh()
          return
        }
        toast.error("验证码错误（开发模式请输入 123456）")
        return
      }

      const res = await fetch("/api/auth/verify-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: trimmedPhone, code: trimmedCode }),
      })

      const data = await res.json()

      if (!res.ok) {
        toast.error(data.error || "验证码错误")
        return
      }

      toast.success("登录成功")
      router.push(redirectTo)
      router.refresh()
    } catch {
      toast.error("登录失败，请重试")
    } finally {
      setLoading(false)
    }
  }, [phone, code, router, isDevMode])

  return (
    <div className="flex flex-col gap-8">
      {/* ── Tab Bar ── */}
      <div className="flex">
        <button
          type="button"
          onClick={() => setActiveTab("wechat")}
          className={`flex-1 flex items-center justify-center gap-1.5 py-3 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "wechat"
              ? "text-[#1E40AF] border-[#1E40AF]"
              : "text-[#64748B] border-[#E2E8F0]"
          }`}
        >
          <MessageCircle className="h-4 w-4" />
          扫码登录
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("phone")}
          className={`flex-1 flex items-center justify-center gap-1.5 py-3 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "phone"
              ? "text-[#1E40AF] border-[#1E40AF]"
              : "text-[#64748B] border-[#E2E8F0]"
          }`}
        >
          <Smartphone className="h-4 w-4" />
          手机号登录
        </button>
      </div>

      {/* ── WeChat QR Section ── */}
      {activeTab === "wechat" && (
        <>
          <WeChatQRCode />
          <TermsText />
        </>
      )}

      {/* ── Phone Login Section ── */}
      {activeTab === "phone" && (
        <div className="flex flex-col gap-4">
          {/* Phone Input */}
          <div className="flex items-center gap-2 h-12 rounded-lg border border-[#E2E8F0] bg-white px-3.5">
            <span className="text-[15px] font-medium text-[#0F172A] shrink-0">
              +86
            </span>
            <span className="w-px h-5 bg-[#E2E8F0] shrink-0" />
            <input
              type="tel"
              value={phone}
              onChange={(e) =>
                setPhone(e.target.value.replace(/\D/g, "").slice(0, 11))
              }
              placeholder="请输入手机号"
              maxLength={11}
              className="flex-1 bg-transparent text-[15px] text-[#0F172A] placeholder:text-[#CBD5E1] outline-none"
            />
          </div>

          {/* Code Input */}
          <div className="flex items-center gap-2 h-12 rounded-lg border border-[#E2E8F0] bg-white px-3.5">
            <input
              type="text"
              value={code}
              onChange={(e) =>
                setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
              }
              placeholder="请输入验证码"
              maxLength={6}
              className="flex-1 bg-transparent text-[15px] text-[#0F172A] placeholder:text-[#CBD5E1] outline-none"
            />
            <button
              type="button"
              onClick={handleSendCode}
              disabled={cooldown > 0 || loading}
              className={`shrink-0 rounded-md px-4 py-1.5 text-[13px] font-medium transition-colors ${
                cooldown > 0
                  ? "bg-[#E2E8F0] text-[#64748B] cursor-not-allowed"
                  : "bg-[#1E40AF] text-white hover:bg-[#1A38A0]"
              } disabled:cursor-not-allowed`}
            >
              {cooldown > 0 ? `${cooldown}s` : "发送验证码"}
            </button>
          </div>
        </div>
      )}

      {/* ── Login Button ── */}
      {activeTab === "phone" && (
        <>
          <button
            type="button"
            onClick={handleLogin}
            disabled={loading}
            className="w-full h-12 rounded-lg bg-[#1E40AF] text-base font-semibold text-white hover:bg-[#1A38A0] transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            登&nbsp;&nbsp;录
          </button>
          <TermsText />
        </>
      )}

      {/* ── Dev Mode QR Login ── */}
      {isDevEnv && (
        <div className="flex flex-col items-center gap-3 pt-4 border-t border-[#E2E8F0]">
          <span className="text-xs text-[#94A3B8]">开发模式扫码登录</span>
          {devQrDataUrl ? (
            <img
              src={devQrDataUrl}
              alt="开发模式登录二维码"
              className="w-40 h-40 rounded-lg border border-[#E2E8F0]"
            />
          ) : (
            <div className="w-40 h-40 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] animate-pulse" />
          )}
          <a
            href="/api/auth/dev-login"
            className="text-sm text-[#1E40AF] font-medium hover:underline"
          >
            桌面端一键登录 →
          </a>
        </div>
      )}
    </div>
  )
}
