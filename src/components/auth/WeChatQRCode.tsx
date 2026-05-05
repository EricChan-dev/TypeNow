"use client"

import { useEffect, useState, useCallback } from "react"
import QRCode from "qrcode"
import { RefreshCw, Loader2, Smartphone } from "lucide-react"

const REFRESH_INTERVAL_MS = 4 * 60 * 1000 // 4 minutes (WeChat codes expire in 5)

export function WeChatQRCode() {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [devMode, setDevMode] = useState(false)

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
      const dataUrl = await QRCode.toDataURL(data.url, {
        width: 200,
        margin: 2,
        color: { dark: "#0F172A", light: "#FFFFFF" },
      })
      setQrDataUrl(dataUrl)
    } catch {
      setError("获取二维码失败，请重试")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchQrCode()
  }, [fetchQrCode])

  // Auto-refresh QR code every 4 minutes
  useEffect(() => {
    if (devMode || !qrDataUrl) return
    const timer = setInterval(fetchQrCode, REFRESH_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [devMode, qrDataUrl, fetchQrCode])

  // Dev mode: show mock button
  if (devMode) {
    return (
      <div className="flex flex-col items-center gap-4">
        <div className="flex h-[200px] w-[200px] items-center justify-center rounded-xl bg-[#F8FAFC] border border-[#E2E8F0]">
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
        <div className="flex h-[200px] w-[200px] items-center justify-center rounded-xl bg-[#F8FAFC] border border-[#E2E8F0]">
          <Loader2 className="h-10 w-10 text-[#1E40AF] animate-spin" />
        </div>
        <p className="text-[13px] text-[#64748B]">正在获取二维码...</p>
      </div>
    )
  }

  // Error state
  if (error || !qrDataUrl) {
    return (
      <div className="flex flex-col items-center gap-4">
        <div className="flex h-[200px] w-[200px] flex-col items-center justify-center gap-3 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0]">
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

  // QR code ready
  return (
    <div className="flex flex-col items-center gap-4">
      <div className="flex h-[200px] w-[200px] items-center justify-center rounded-xl bg-white border border-[#E2E8F0] p-2">
        <img
          src={qrDataUrl}
          alt="微信扫码登录二维码"
          width={200}
          height={200}
          className="h-full w-full object-contain"
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
    </div>
  )
}
