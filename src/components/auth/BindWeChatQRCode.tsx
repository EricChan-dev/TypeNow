"use client"

import { useState, useEffect, useCallback } from "react"
import { Loader2, RefreshCw } from "lucide-react"
import { cn } from "@/lib/utils"

export function BindWeChatQRCode() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [devMode, setDevMode] = useState(false)

  const fetchQrCode = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/auth/bind/wechat/url")
      const data = await res.json()

      if (data.devMode) {
        setDevMode(true)
        return
      }

      if (data.url) {
        const { default: QRCode } = await import("qrcode")
        const dataUrl = await QRCode.toDataURL(data.url, {
          width: 200,
          margin: 2,
          color: { dark: "#ffffff", light: "#00000000" },
        })
        setQrDataUrl(dataUrl)
      } else {
        setError(data.error ?? "获取二维码失败")
      }
    } catch {
      setError("获取二维码失败，请重试")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchQrCode()
    // Auto-refresh every 4 minutes (WeChat codes expire in ~5 min)
    const timer = setInterval(fetchQrCode, 4 * 60 * 1000)
    return () => clearInterval(timer)
  }, [fetchQrCode])

  if (loading) {
    return (
      <div className="flex flex-col items-center gap-3 py-6">
        <Loader2 className="h-6 w-6 text-white/40 animate-spin" />
        <p className="text-sm text-white/30">正在获取二维码...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 py-6">
        <p className="text-sm text-red-400">{error}</p>
        <button
          onClick={fetchQrCode}
          className="flex items-center gap-1.5 text-xs text-white/40 hover:text-white/70 transition-colors"
        >
          <RefreshCw className="h-3 w-3" />
          重试
        </button>
      </div>
    )
  }

  if (devMode) {
    return (
      <div className="flex flex-col items-center gap-3 py-4">
        <a
          href="/api/auth/wechat/callback?code=dev_mock&state=bind_dev_mock"
          className={cn(
            "px-6 py-2.5 rounded-xl text-sm font-medium text-white transition-all",
            "bg-violet-500/20 border border-violet-500/30 hover:bg-violet-500/30",
          )}
        >
          开发模式绑定微信
        </a>
        <p className="text-[10px] text-white/25">调试环境，点击即可模拟绑定</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center gap-3 py-2">
      {qrDataUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={qrDataUrl}
          alt="微信绑定二维码"
          className="w-[200px] h-[200px] rounded-lg border border-white/[0.08]"
        />
      )}
      <p className="text-xs text-white/30">请使用微信扫描二维码绑定</p>
      <button
        onClick={fetchQrCode}
        className="flex items-center gap-1 text-[10px] text-white/25 hover:text-white/45 transition-colors"
      >
        <RefreshCw className="h-2.5 w-2.5" />
        刷新二维码
      </button>
    </div>
  )
}
