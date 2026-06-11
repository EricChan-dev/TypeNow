"use client"

import { useEffect, useState, useCallback, useRef } from "react"
import { RefreshCw, Loader2, Smartphone, CheckCircle2 } from "lucide-react"
import { isWechatBrowser, isMobile } from "@/lib/device"

export function WeChatQRCode() {

  const [qrImageUrl, setQrImageUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [devMode, setDevMode] = useState(false)
  const [devScene, setDevScene] = useState<string | null>(null)
  const [redirecting, setRedirecting] = useState(false)
  const [showMobileHint, setShowMobileHint] = useState(false)
  const [loggedIn, setLoggedIn] = useState(false)
  const [expiresIn, setExpiresIn] = useState(0)

  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const mountedRef = useRef(true)

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current)
      pollingRef.current = null
    }
  }, [])

  const fetchQrCode = useCallback(async () => {
    stopPolling()
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/auth/wechat/oa-qrcode")
      const data = await res.json()

      if (!res.ok) {
        setError(data.error || "获取二维码失败")
        return
      }

      if (data.devMode) {
        setDevMode(true)
        setDevScene(data.scene)
        // Start polling for dev mode too
        startPolling(data.scene)
        return
      }

      setDevMode(false)
      setDevScene(null)
      setQrImageUrl(data.qrImageUrl)
      setExpiresIn(data.expiresIn || 30)

      // Start polling for login
      startPolling()
    } catch {
      setError("获取二维码失败，请重试")
    } finally {
      setLoading(false)
    }
  }, [stopPolling])

  const startPolling = useCallback((devSceneOverride?: string) => {
    stopPolling()
    mountedRef.current = true

    pollingRef.current = setInterval(async () => {
      if (!mountedRef.current) {
        stopPolling()
        return
      }

      try {
        const params = devSceneOverride
          ? `?dev_scene=${encodeURIComponent(devSceneOverride)}`
          : ""
        const res = await fetch(`/api/auth/wechat/oa-check${params}`)
        const data = await res.json()

        if (data.success) {
          stopPolling()
          setLoggedIn(true)
          // Redirect to home (use window.location for reliable navigation)
          setTimeout(() => {
            window.location.href = "/home?login_success=wechat" + (data.isNewUser ? "&new_user=1" : "")
          }, 800)
        } else if (data.error === "no_scene") {
          // Scene cookie missing — refresh QR
          stopPolling()
          fetchQrCode()
        }
      } catch {
        // Network error — try again next interval
      }
    }, 2000)
  }, [stopPolling, fetchQrCode])

  // Auto-refresh QR code when it expires
  useEffect(() => {
    if (expiresIn <= 0 || devMode || !qrImageUrl) return
    const refreshTimer = setTimeout(() => {
      if (mountedRef.current) {
        fetchQrCode()
      }
    }, (expiresIn + 2) * 1000)
    return () => clearTimeout(refreshTimer)
  }, [expiresIn, devMode, qrImageUrl, fetchQrCode])

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

  // Fetch QR code on mount
  useEffect(() => {
    fetchQrCode()
  }, [fetchQrCode])

  // Cleanup
  useEffect(() => {
    return () => {
      mountedRef.current = false
      stopPolling()
    }
  }, [stopPolling])

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

  // Logged in successfully
  if (loggedIn) {
    return (
      <div className="flex flex-col items-center gap-4">
        <div className="flex h-[400px] w-[300px] flex-col items-center justify-center gap-3 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0]">
          <CheckCircle2 className="h-12 w-12 text-green-500" />
          <span className="text-[15px] font-medium text-[#0F172A]">登录成功</span>
          <span className="text-[13px] text-[#64748B]">正在跳转...</span>
        </div>
      </div>
    )
  }

  // Dev mode: show mock button
  if (devMode && devScene) {
    return (
      <div className="flex flex-col items-center gap-4">
        <div className="flex h-[400px] w-[300px] flex-col items-center justify-center gap-3 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0]">
          <a
            href={`/api/auth/wechat/oa-check?dev_scene=${encodeURIComponent(devScene)}`}
            className="flex flex-col items-center gap-3 py-4 px-6 rounded-lg bg-[#1E40AF] text-white hover:bg-[#1A38A0] transition-colors"
          >
            <Smartphone className="h-10 w-10" />
            <span className="text-[13px] font-medium">开发模式登录</span>
            <span className="text-[11px] opacity-70">模拟公众号关注</span>
          </a>
        </div>
        <p className="text-[13px] text-[#64748B]">
          开发模式：点击按钮模拟关注公众号登录
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
  if (error) {
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

  // QR code ready — show OA QR code image for scanning
  return (
    <div className="flex flex-col items-center gap-4">
      <div className="overflow-hidden rounded-xl border border-[#E2E8F0] bg-white">
        {qrImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={qrImageUrl}
            alt="扫码关注公众号登录"
            width={300}
            height={400}
            className="block"
          />
        ) : (
          <div className="w-[300px] h-[400px] bg-[#F8FAFC] animate-pulse" />
        )}
      </div>
      <div className="flex items-center gap-2">
        <p className="text-[13px] text-[#64748B]">
          请使用微信扫码关注公众号登录
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
      <p className="text-[12px] text-[#94A3B8]">
        关注公众号后自动登录，无需手动确认
      </p>
      {showMobileHint && (
        <p className="text-[12px] text-[#94A3B8]">
          推荐在微信中打开此页面，可直接授权登录
        </p>
      )}
    </div>
  )
}
