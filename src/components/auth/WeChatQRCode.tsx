"use client"

import { useEffect, useState, useCallback, useRef } from "react"
import { RefreshCw, Loader2, Smartphone, CheckCircle2 } from "lucide-react"
import { isWechatBrowser, isMobile } from "@/lib/device"

interface Props {
  /**
   * 该二维码面板当前是否可见。
   *
   * 登录页把两个 tab 面板都常驻在 DOM 里（用 `hidden` 切换，为了保持
   * `.content.on` 的参考版式），但**取码请求不应该在电话 tab 上就发出去** ——
   * 那会白白消耗公众号二维码配额，还会把「获取二维码失败」直接甩到刚进页面
   * 的用户眼前。所以由父组件把激活状态传进来，只有轮到微信 tab 才真正取码。
   */
  active?: boolean
  /**
   * 扫码登录成功、但这个微信账号还没绑手机号时调用。
   *
   * 父组件据此把用户切到「验证码登录」tab 完成绑定（见 LoginForm 的 bindMode）——
   * 用户已经在这个页面上了，没必要整页跳回 /login 再重新挂载一次。
   *
   * 参数是**本来要去的** /home 地址（含 login_success 等 query），绑定成功后
   * 仍然跳过去，这样「微信登录成功」的提示与新人引导都不会丢。
   */
  onNeedsBind?: (nextPath: string) => void
}

export function WeChatQRCode({ active = true, onNeedsBind }: Props) {
  const [qrImageUrl, setQrImageUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  /**
   * 错误码（如 OA_IP_NOT_ALLOWED）。用于区分「有明确修复动作的配置问题」和
   * 「纯临时故障」——后者给一句提示 + 重试就够了，前者还要告诉用户怎么修。
   */
  const [errorCode, setErrorCode] = useState<string | null>(null)
  const [devMode, setDevMode] = useState(false)
  const [devScene, setDevScene] = useState<string | null>(null)
  const [redirecting, setRedirecting] = useState(false)
  const [showMobileHint, setShowMobileHint] = useState(false)
  const [loggedIn, setLoggedIn] = useState(false)
  const [expiresIn, setExpiresIn] = useState(0)
  const [expired, setExpired] = useState(false)

  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const mountedRef = useRef(true)
  /**
   * 最新一次的 onNeedsBind。
   *
   * 轮询是在 setInterval 里跑很久的闭包，而 onNeedsBind 是父组件每次渲染都会
   * 新建的函数引用 —— 直接闭包进来会捕获住旧引用；放进依赖数组又会让
   * setInterval 被反复重建、打乱 2s 轮询节拍。用 ref 每次渲染同步一次最省事。
   */
  const onNeedsBindRef = useRef(onNeedsBind)
  useEffect(() => {
    onNeedsBindRef.current = onNeedsBind
  }, [onNeedsBind])

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current)
      pollingRef.current = null
    }
  }, [])

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
          // 本来要去的地址。带着它跳，绑完手机号后仍能落到 /home 并看到
          // 「微信登录成功」与新人引导（参数由 oa-check 决定，别在这里重造）。
          const next =
            "/home?login_success=wechat" + (data.isNewUser ? "&new_user=1" : "")
          if (data.needsBind) {
            // 微信账号没绑手机号：不跳 /home（那边会把我们弹回来），
            // 就在这个页面切到「验证码登录」tab 完成绑定。
            onNeedsBindRef.current?.(next)
            return
          }
          setTimeout(() => {
            window.location.href = next
          }, 800)
        } else if (data.error === "no_scene") {
          stopPolling()
          // Scene cookie missing — show error instead of auto-refresh
          setError("二维码已过期，请刷新重试")
          setExpired(true)
        }
      } catch {
        // Network error — try again next interval
      }
    }, 2000)
    // 这里刻意不依赖 onNeedsBind（父组件每次渲染都给新引用，放进来会让
    // setInterval 被反复重建、打乱 2s 轮询节拍）；改用 onNeedsBindRef 取最新值。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stopPolling])

  const fetchQrCode = useCallback(async () => {
    stopPolling()
    setLoading(true)
    setError(null)
    setErrorCode(null)
    setExpired(false)
    try {
      const res = await fetch("/api/auth/wechat/oa-qrcode")
      const data = await res.json()

      if (!res.ok) {
        setError(data.error || "获取二维码失败")
        setErrorCode(typeof data.code === "string" ? data.code : null)
        return
      }

      if (data.devMode) {
        setDevMode(true)
        setDevScene(data.scene)
        startPolling(data.scene)
        return
      }

      setDevMode(false)
      setDevScene(null)
      setQrImageUrl(data.qrImageUrl)
      setExpiresIn(data.expiresIn || 30)

      startPolling()
    } catch {
      setError("获取二维码失败，请重试")
    } finally {
      setLoading(false)
    }
  }, [stopPolling, startPolling])

  // When QR code expires, show mask instead of auto-refreshing
  useEffect(() => {
    if (expiresIn <= 0 || devMode || !qrImageUrl) return
    const refreshTimer = setTimeout(() => {
      if (mountedRef.current) {
        stopPolling()
        setExpired(true)
      }
    }, (expiresIn + 2) * 1000)
    return () => clearTimeout(refreshTimer)
  }, [expiresIn, devMode, qrImageUrl, stopPolling])

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

  // Fetch QR code when this panel becomes active.
  //
  // 注意这里是按 `active` 取码，不是无脑 mount 时取码：登录页的两个 tab 面板
  // 为了保持 `.content.on` 的参考版式是**常驻 DOM** 的，挂载即取码会让停在
  // 电话 tab 的用户也白发一次公众号二维码请求。
  //
  // 离开时停轮询、回来时**必须把轮询接回去**：二维码仍有效时不能重新取码
  // （重新取码会作废旧码，而用户可能刚扫完、还没在公众号里点关注），
  // 但轮询一停，扫码后的 oa-check 就没人问了 —— 用户扫完会一直卡在「等待」。
  useEffect(() => {
    if (!active) {
      stopPolling()
      return
    }
    // 开发模式：把模拟轮询接回去
    if (devMode && devScene) {
      startPolling(devScene)
      return
    }
    // 还没取到码 —— 正常取码（fetchQrCode 内部会启动轮询）
    if (!qrImageUrl) {
      fetchQrCode()
      return
    }
    // 已有二维码：只把轮询接回去。已过期的不接，等用户点「点击刷新」。
    if (!expired) startPolling()
    // fetchQrCode / startPolling / stopPolling 都是 useCallback 稳定引用，这里
    // 只想在「激活状态变化」时决策，不希望在拿到二维码后因 qrImageUrl 变化再触发。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

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
        <div className="code-box" style={{ minHeight: 360 }}>
          <Loader2 className="h-10 w-10 text-[#2563eb] animate-spin" />
          <span className="text-[13px] text-[#64748B]">正在跳转微信授权...</span>
        </div>
      </div>
    )
  }

  // Logged in successfully
  if (loggedIn) {
    return (
      <div className="flex flex-col items-center gap-4">
        <div className="code-box" style={{ minHeight: 360 }}>
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
        <div className="code-box" style={{ minHeight: 360 }}>
          <a
            href={`/api/auth/wechat/oa-check?dev_scene=${encodeURIComponent(devScene)}`}
            className="flex flex-col items-center gap-3 py-4 px-6 rounded-lg bg-[#2563eb] text-white hover:bg-[#1D4ED8] transition-colors"
          >
            <Smartphone className="h-10 w-10" />
            <span className="text-[13px] font-medium">开发模式登录</span>
            <span className="text-[11px] opacity-70">模拟公众号关注</span>
          </a>
        </div>
        <p className="text-[13px] text-[#64748B]">开发模式：点击按钮模拟关注公众号登录</p>
      </div>
    )
  }

  // Loading state
  if (loading) {
    return (
      <div className="flex flex-col items-center gap-4">
        <div className="code-box" style={{ minHeight: 360 }}>
          <Loader2 className="h-10 w-10 text-[#2563eb] animate-spin" />
        </div>
        <p className="text-[13px] text-[#64748B]">正在获取二维码...</p>
      </div>
    )
  }

  // Error state
  if (error && !qrImageUrl) {
    // OA_IP_NOT_ALLOWED 是**可自助修复**的配置问题（服务器出口 IP 未加入公众号
    // 白名单），文案比通用故障长得多，所以单独走一个左对齐、可换行的版式：
    // 通用故障居中一行就够，长文案挤在 .code-box 里会读不清。
    const isConfigError = errorCode === "OA_IP_NOT_ALLOWED"
    return (
      <div className="flex flex-col items-center gap-4">
        <div
          className={
            isConfigError
              ? "code-box !h-auto !items-start !gap-3 !px-5 !py-6 text-left"
              : "code-box"
          }
          style={isConfigError ? undefined : { minHeight: 360 }}
        >
          {isConfigError && (
            <span className="text-[14px] font-semibold text-[#0F172A]">
              二维码暂时无法生成
            </span>
          )}
          <span
            className={
              isConfigError
                ? "text-[13px] leading-[22px] text-[#64748B]"
                : "text-[13px] text-[#64748B]"
            }
          >
            {error}
          </span>
          <button
            type="button"
            onClick={fetchQrCode}
            className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[#2563eb] hover:opacity-80 transition-opacity"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            重试
          </button>
        </div>
        {isConfigError && (
          <p className="text-[13px] text-[#64748B]">
            着急登录？可先切换到「验证码登录」，或用短信验证码登录。
          </p>
        )}
      </div>
    )
  }

  // QR code ready — show with optional expired mask overlay
  return (
    <div className="flex flex-col items-center gap-4">
 {/* 二维码容器沿用基准实现 .content .code 的虚线框（见 app/login/login.css） */}
      <div className="code-box">
        <div className="relative overflow-hidden rounded-lg border border-[#E2E8F0] bg-white">
          {qrImageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={qrImageUrl}
              alt="扫码关注公众号登录"
              width={300}
              height={400}
              className={`block ${expired ? "opacity-20" : ""}`}
            />
          ) : (
            <div className="w-[300px] h-[400px] bg-[#F8FAFC] animate-pulse" />
          )}

          {/* Expired overlay mask */}
          {expired && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/5">
              <span className="text-[14px] font-medium text-[#475569]">二维码已过期</span>
              <button
                type="button"
                onClick={fetchQrCode}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#2563eb] text-white text-[13px] font-medium px-4 py-2 hover:bg-[#1D4ED8] transition-colors"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                点击刷新
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Footer text */}
      <div className="flex items-center gap-2">
        <p className="text-[13px] text-[#64748B]">
          {expired ? "二维码已过期，请点击刷新" : "请使用微信扫码关注公众号登录"}
        </p>
        {!expired && (
          <button
            type="button"
            onClick={fetchQrCode}
            className="inline-flex items-center gap-1 text-[12px] text-[#2563eb] hover:opacity-80 transition-opacity"
            title="刷新二维码"
          >
            <RefreshCw className="h-3 w-3" />
          </button>
        )}
      </div>

      {!expired && (
        <p className="text-[12px] text-[#94A3B8]">关注公众号后自动登录，无需手动确认</p>
      )}
      {showMobileHint && (
        <p className="text-[12px] text-[#94A3B8]">
          推荐在微信中打开此页面，可直接授权登录
        </p>
      )}
    </div>
  )
}
