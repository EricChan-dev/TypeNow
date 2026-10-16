"use client"

/**
 * 发送短信验证码的滑块人机校验 + 发送触发器（登录页 / 设置页两处共用）。
 *
 * 交互模型（替代旧的「点按钮 → 阿里云弹层」）：
 *   1. 用户填好手机号后**直接拖动滑块**对齐拼图 —— 滑块就是发送按钮；
 *   2. onVerify 里带着服务端下发的题目 id 与 {x, duration, trail} 调
 *      /api/auth/send-sms，判分在服务端（答案只存库，不落客户端）；
 *   3. 成功 → 绿色反馈 + 60s 倒计时（倒计时期间整个滑块卸载，防止重复拖）；
 *   4. 人机没过（captchaFailed）→ reject，控件自动换题重试；
 *   5. 业务失败（限流/短信服务问题）→ 人机已通过，不把用户赶回去重拖，
 *      resolve 后静默换一张新题，只弹错误提示。
 *
 * 样式：rc-slider-captcha 自带运行时样式注入（无需 import css），
 * 深浅两处场景用 CSS 变量（--rcsc-*）微调。
 */
import { useCallback, useEffect, useRef, useState } from "react"
import SliderCaptcha, { type ActionType, type VerifyParam } from "rc-slider-captcha"
import { toast } from "sonner"

const PHONE_REGEX = /^1[3-9]\d{9}$/

// 轨迹数组直接透传服务端；截断到 300 点防止极端拖拽把请求体撑爆
const MAX_TRAIL_POINTS = 300

export interface SmsSliderProps {
  /** 收件手机号（发送前先校验格式） */
  phone: string
  /**
   * 手机号无效时的提示文案；null/undefined = 有效。
   * 不传则用内置正则校验。
   */
  phoneError?: string | null
  /** 短信发送成功后的额外副作用 */
  onSent?: () => void
  /** 配色：light=登录卡片（浅底，默认），dark=设置面板（深底） */
  tone?: "light" | "dark"
  /** 根节点 id（wiring 测试锚点：login-sms-slider / settings-sms-slider） */
  id?: string
  /** 根节点额外 className */
  className?: string
}

const TONE_VARS = {
  light: {
    "--rcsc-bg-color": "#f8fafc",
  } as React.CSSProperties,
  dark: {
    "--rcsc-bg-color": "rgba(255,255,255,0.06)",
    "--rcsc-border-color": "rgba(255,255,255,0.14)",
    "--rcsc-text-color": "#d4d4d8",
    "--rcsc-button-bg-color": "rgba(255,255,255,0.08)",
    "--rcsc-button-hover-color": "rgba(255,255,255,0.16)",
    "--rcsc-button-color": "#a78bfa",
  } as React.CSSProperties,
}

export default function SmsSlider({
  phone,
  phoneError,
  onSent,
  tone = "light",
  id,
  className,
}: SmsSliderProps) {
  const [cooldown, setCooldown] = useState(0)
  const actionRef = useRef<ActionType | undefined>(undefined)
  // 当前题目的 id：request() 成功时记下，onVerify 时作为「这题的答案」提交
  const challengeIdRef = useRef<string | null>(null)
  const cooldownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    return () => {
      if (cooldownTimerRef.current) clearInterval(cooldownTimerRef.current)
    }
  }, [])

  const startCooldown = useCallback(() => {
    // 与 LoginForm 旧实现同口径：**同步**先置 60，不等 setState 落地，
    // 否则用户能在 React 提交前再拖一次，并发发出第二条短信。
    setCooldown(60)
    if (cooldownTimerRef.current) clearInterval(cooldownTimerRef.current)
    cooldownTimerRef.current = setInterval(() => {
      setCooldown((prev) => {
        if (prev <= 1) {
          if (cooldownTimerRef.current) clearInterval(cooldownTimerRef.current)
          cooldownTimerRef.current = null
          return 0
        }
        return prev - 1
      })
    }, 1000)
  }, [])

  /** 取一张新题（rc-slider-captcha 挂载/刷新时调用） */
  const request = useCallback(async () => {
    const res = await fetch("/api/auth/captcha")
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      throw new Error(data.error || "验证码加载失败，请重试")
    }
    challengeIdRef.current = data.id
    // 服务端几何与库默认一致（320x160 / 拼图宽 60），不做缩放 ——
    // VerifyParam.x 就是原始像素位移，无需换算。
    return { bgUrl: data.background as string, puzzleUrl: data.puzzle as string }
  }, [])

  /** 拖动完成：服务端判分并发送短信。resolve=成功，reject=失败（自动换题）。 */
  const onVerify = useCallback(
    async (data: VerifyParam) => {
      const invalidPhone = phoneError ?? (PHONE_REGEX.test(phone.trim()) ? null : "请输入有效的手机号")
      if (invalidPhone) {
        toast.error(invalidPhone)
        // reject：题目作废换新题。手机号都没填对，不值得为这次拖动发请求。
        throw new Error(invalidPhone)
      }
      if (!challengeIdRef.current) {
        throw new Error("验证码未就绪，请重试")
      }

      const res = await fetch("/api/auth/send-sms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: phone.trim(),
          captcha: {
            id: challengeIdRef.current,
            x: data.x,
            duration: data.duration,
            trail: Array.isArray(data.trail) ? data.trail.slice(0, MAX_TRAIL_POINTS) : [],
          },
        }),
      })
      const result = await res.json().catch(() => ({}))

      if (!res.ok) {
        if (result.captchaFailed === true) {
          // 人机没过（题目过期/已用/判分不过）：reject 让控件自动换题重试
          throw new Error(result.error || "人机验证未通过，请重试")
        }
        // 业务失败（限流/短信服务问题）：人机已通过，不能把用户赶回去重拖。
        // 旧题已被服务端消费，resolve 后换一张新题，只提示错误。
        toast.error(result.error || "发送验证码失败，请重试")
        setTimeout(() => actionRef.current?.refresh(), 0)
        return
      }

      toast.success(result.message || "验证码已发送")
      startCooldown()
      onSent?.()
    },
    [phone, phoneError, startCooldown, onSent]
  )

  // 倒计时期间整个滑块卸载：既防重复拖动，倒计时结束重新挂载时
  // autoRequest 会自动取新题，用户直接再拖即可重新发送。
  if (cooldown > 0) {
    return (
      <div id={id} className={className} data-cooldown={cooldown}>
        <p className="text-xs text-center py-3 text-emerald-500">
          验证码已发送，{cooldown}s 后可重新获取
        </p>
      </div>
    )
  }

  return (
    <div id={id} className={className} style={TONE_VARS[tone]}>
      <SliderCaptcha
        actionRef={actionRef}
        mode="embed"
        request={request}
        onVerify={onVerify}
        // autoRefreshOnError 默认 true：onVerify reject 后自动换题重试
        tipText={{ default: "按住滑块，拖动对齐拼图缺口" }}
        style={{ width: "100%" }}
      />
    </div>
  )
}
