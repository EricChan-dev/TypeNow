"use client"

import { useCallback, useState } from "react"
import { useRouter } from "next/navigation"
import { Button, Input } from "antd"
import { Smartphone, X } from "lucide-react"
import { toast } from "sonner"
import { signOutAction } from "@/app/actions/auth"

const PHONE_REGEX = /^1[3-9]\d{9}$/

interface BindPhoneModalProps {
  /**
   * 提供时右上角出现关闭按钮，弹窗可关（用于设置页那种"主动去绑"的场景）。
   * **不提供时是不可关闭的**：微信登录建号拿不到手机号，而手机号是唯一能把
   * 「微信注册的号」和「手机号注册的号」认成同一个人的凭据 —— 不强制绑定，
   * 同一个人就会有两个账号，而系统没有自助合并能力（见 lib/phone-gate）。
   */
  onClose?: () => void
  /** 弹窗标题下的一句话，说明"为什么现在要绑" */
  reason?: string
}

/**
 * 绑定手机号的通用弹窗。
 *
 * 既作为微信登录后的强制闸门（在 home/layout 里全局挂载，此时不可关闭），
 * 也可以被任何页面主动打开（传 onClose）。
 *
 * 为什么是弹窗而不是独立页：绑手机号是"做某件事之前的一道手续"，不是目的地。
 * 独立页会把用户从当前上下文里拽走（正在看的那一课、那一句都没了），
 * 绑完还得自己找回来；弹窗则原地完成、原地继续。
 */
export function BindPhoneModal({ onClose, reason }: BindPhoneModalProps) {
  const router = useRouter()
  const [phone, setPhone] = useState("")
  const [code, setCode] = useState("")
  const [countdown, setCountdown] = useState(0)
  const [sending, setSending] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  /** 不可重试的失败（撞号等）留在弹窗里讲清楚，不用 toast 一闪而过 */
  const [blocked, setBlocked] = useState<string | null>(null)

  const sendCode = useCallback(async () => {
    if (!PHONE_REGEX.test(phone)) {
      toast.error("请输入有效的手机号")
      return
    }
    if (countdown > 0) return
    setSending(true)
    try {
      const res = await fetch("/api/auth/send-sms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "发送失败")
      toast.success("验证码已发送")
      setCountdown(60)
      const timer = setInterval(() => {
        setCountdown((c) => {
          if (c <= 1) clearInterval(timer)
          return c - 1
        })
      }, 1000)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "发送失败，请重试")
    } finally {
      setSending(false)
    }
  }, [phone, countdown])

  const submit = useCallback(async () => {
    if (!PHONE_REGEX.test(phone)) {
      toast.error("请输入有效的手机号")
      return
    }
    if (code.length !== 6) {
      toast.error("请输入 6 位验证码")
      return
    }
    setSubmitting(true)
    setBlocked(null)
    try {
      const res = await fetch("/api/auth/bind/phone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, code }),
      })
      const data = await res.json()
      if (!res.ok) {
        if (data.code === "PHONE_TAKEN" || data.code === "PHONE_CONFLICT") {
          setBlocked(data.error ?? "该手机号已用于另一个账号")
          return
        }
        throw new Error(data.error ?? "绑定失败")
      }
      // switched=true：手机号原本就有账号，已把微信身份转过去并切换会话 ——
      // 用户接下来用的是那个"带历史记录"的账号，而不是刚才的空壳账号
      toast.success(
        data.switched ? "已登录你的手机号账号，并把微信绑定到它上面" : "手机号绑定成功",
      )
      onClose?.()
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "绑定失败，请重试")
    } finally {
      setSubmitting(false)
    }
  }, [phone, code, router, onClose])

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      {/* 不可关闭时不挂点击遮罩关闭 —— 点背景什么都不会发生 */}
      <div
        className="absolute inset-0 bg-black/60"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="绑定手机号"
        className="relative w-full max-w-sm rounded-2xl border border-border p-6 flex flex-col gap-4"
        style={{ background: "var(--surface)" }}
      >
        {onClose ? (
          <button
            onClick={onClose}
            aria-label="关闭"
            className="absolute right-4 top-4 w-7 h-7 rounded-lg bg-muted flex items-center justify-center hover:bg-border transition-colors"
          >
            <X className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
        ) : null}

        <div className="flex items-start gap-3">
          <span
            className="flex items-center justify-center w-10 h-10 rounded-xl shrink-0"
            style={{ background: "#7c3aed18", border: "1px solid #7c3aed30" }}
          >
            <Smartphone className="h-5 w-5 text-violet-400" />
          </span>
          <div>
            <h2 className="text-base font-semibold text-foreground">绑定手机号</h2>
            <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
              {reason ??
                "微信登录拿不到手机号，而手机号是账号的唯一凭据 —— 绑好之后，你用手机号或微信都能进同一个账号，学习记录不会分散在两处。"}
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Input
            size="large"
            placeholder="手机号"
            value={phone}
            maxLength={11}
            onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))}
          />
          <div className="flex gap-2">
            <Input
              size="large"
              placeholder="6 位验证码"
              value={code}
              maxLength={6}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              onPressEnter={submit}
            />
            <Button size="large" onClick={sendCode} loading={sending} disabled={countdown > 0}>
              {countdown > 0 ? `${countdown}s` : "获取验证码"}
            </Button>
          </div>
        </div>

        {blocked ? (
          <p className="rounded-lg border border-amber-500/30 bg-amber-500/[0.06] px-3 py-2 text-[12px] leading-relaxed text-foreground/80">
            {blocked}
          </p>
        ) : null}

        <Button type="primary" size="large" onClick={submit} loading={submitting}>
          绑定并继续
        </Button>

        {!onClose ? (
          <button
            type="button"
            onClick={async () => {
              // 用与顶栏同一个 server action（用户侧没有 logout 接口）
              try {
                await signOutAction()
              } catch {
                /* 失败也照样回首页 */
              }
              window.location.href = "/"
            }}
            className="text-[12px] text-muted-foreground underline-offset-2 hover:underline"
          >
            先不绑定，退出登录
          </button>
        ) : null}
      </div>
    </div>
  )
}
