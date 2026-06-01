"use client"

import { useEffect, useState, useCallback } from "react"
import { RefreshCw, Loader2, Smartphone } from "lucide-react"
import { isWechatBrowser, isMobile } from "@/lib/device"

export function WeChatQRCode() {
  const [qrUrl, setQrUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [devMode, setDevMode] = useState(false)
  const [redirecting, setRedirecting] = useState(false)
  const [showMobileHint, setShowMobileHint] = useState(false)

  const fetchQrCode = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/auth/wechat/url")
      const data = await res.json()

      if (!res.ok) {
        setError(data.error || "获取二维码失败")
        return
      }

      if (data.devMode) {
        setDevMode(true)
        return
      }

      setDevMode(false)
      setQrUrl(data.url)
    } catch {
      setError("获取二维码失败，请重试")
    } finally {
      setLoading(false)
    }
  }, [])

  // Auto-redirect for WeChat browser on mobile (uses OA OAuth flow)
  useEffect(() => {
    if (!isWechatBrowser() || !isMobile()) {
      if (isMobile()) setShowMobileHint(true)
      return
    }
    setRedirecting(true)
    fetch("/api/auth/wechat/url?flow=oa")
      .then((r) => r.json())
      .then((data) => {
        if (data.url) {
          window.location.href = data.url
        } else {
          setError(data.error || "微信授权跳转失败")
          setRedirecting(false)
        }
      })
      .catch(() => {
        setError("微信授权跳转失败，请重试")
        setRedirecting(false)
      })
  }, [])

  useEffect(() => {
    fetchQrCode()
  }, [fetchQrCode])

  // WeChat browser redirecting state
  if (redirecting) {
    return (
      <div className="flex flex-col items-center gap-4">
        <div className="flex h-[400px] w-[300px] flex-col items-center justify-center gap-3 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0]">
          <Loader2 className="h-10 w-10 text-[#1E40AF] animate-spin" />
          <span className="text-[13px] text-[#64748B]">正在跳转微信授权...</span>
        </div>
      </div>
    )
  }

  // Dev mode: show mock button
  if (devMode) {
    return (
      <div className="flex flex-col items-center gap-4">
        <div className="flex h-[400px] w-[300px] items-center justify-center rounded-xl bg-[#F8FAFC] border border-[#E2E8F0]">
          <a
            href="/api/auth/wechat/callback?code=dev_mock&state=dev_mock"
            className="flex flex-col items-center gap-3 py-4 px-6 rounded-lg bg-[#1E40AF] text-white hover:bg-[#1A38A0] transition-colors"
          >
            <Smartphone className="h-10 w-10" />
            <span className="text-[13px] font-medium">开发模式登录</span>
            <span className="text-[11px] opacity-70">模拟微信扫码</span>
          </a>
        </div>
        <p className="text-[13px] text-[#64748B]">
          开发模式：点击按钮模拟微信登录
        </p>
      </div>
    )
  }

  // Loading state
  if (loading) {
    return (
      <div className="flex flex-col items-center gap-4">
        <div className="flex h-[400px] w-[300px] items-center justify-center rounded-xl bg-[#F8FAFC] border border-[#E2E8F0]">
          <Loader2 className="h-10 w-10 text-[#1E40AF] animate-spin" />
        </div>
        <p className="text-[13px] text-[#64748B]">正在获取二维码...</p>
      </div>
    )
  }

  // Error state
  if (error || !qrUrl) {
    return (
      <div className="flex flex-col items-center gap-4">
        <div className="flex h-[400px] w-[300px] flex-col items-center justify-center gap-3 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0]">
          <span className="text-[13px] text-[#64748B]">{error}</span>
          <button
            type="button"
            onClick={fetchQrCode}
            className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[#1E40AF] hover:opacity-80 transition-opacity"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            重试
          </button>
        </div>
      </div>
    )
  }

  // QR code ready — load WeChat's native qrconnect page in an iframe
  // WeChat internally renders the confirm QR code; scanning it opens the auth confirmation directly
  return (
    <div className="flex flex-col items-center gap-4">
      <div className="overflow-hidden rounded-xl border border-[#E2E8F0]">
        <iframe
          src={qrUrl}
          width={300}
          height={400}
          frameBorder={0}
          scrolling="no"
          title="微信扫码登录"
        />
      </div>
      <div className="flex items-center gap-2">
        <p className="text-[13px] text-[#64748B]">
          请使用微信扫描二维码登录
        </p>
        <button
          type="button"
          onClick={fetchQrCode}
          className="inline-flex items-center gap-1 text-[12px] text-[#1E40AF] hover:opacity-80 transition-opacity"
          title="刷新二维码"
        >
          <RefreshCw className="h-3 w-3" />
        </button>
      </div>
      {showMobileHint && (
        <p className="text-[12px] text-[#94A3B8]">
          推荐在微信中打开此页面，可直接授权登录
        </p>
      )}
    </div>
  )
}
