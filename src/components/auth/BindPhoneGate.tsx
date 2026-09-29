"use client"

import { useCallback, useState } from "react"
import { useRouter } from "next/navigation"
import { Button, Input } from "antd"
import { toast } from "sonner"
import { signOutAction } from "@/app/actions/auth"

const PHONE_REGEX = /^1[3-9]\d{9}$/

/**
 * 强制绑定手机号的表单（/bind-phone）。
 *
 * 与设置页里那个自愿绑定的入口共用同一套接口（/api/auth/send-sms 与
 * /api/auth/bind/phone），区别是这里**拦在进站之前**：不绑定就进不去 /home。
 *
 * 为什么拦在进站之前（而不是用一阵子再提示）：微信建号时拿不到手机号，
 * 而手机号是唯一能把「微信注册的号」和「手机号注册的号」认成同一个人的凭据。
 * 若允许先用后绑，微信壳账号就会攒下练习数据，撞号时无法自动转移，
 * 只能请人工合并 —— 而系统没有自助合并能力。见 lib/phone-gate。
 */
export function BindPhoneGate() {
  const router = useRouter()
  const [phone, setPhone] = useState("")
  const [code, setCode] = useState("")
  const [countdown, setCountdown] = useState(0)
  const [sending, setSending] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  /** 不可重试的失败（撞号等）留在页面上讲清楚，不用 toast 一闪而过 */
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
      // switched=true 表示该手机号原本就有账号，已把微信身份转过去并切换会话：
      // 用户接下来用的是那个"带着历史记录"的账号，而不是刚才那个空壳账号
      toast.success(
        data.switched ? "已登录你的手机号账号，并把微信绑定到它上面" : "手机号绑定成功",
      )
      router.replace("/home")
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "绑定失败，请重试")
    } finally {
      setSubmitting(false)
    }
  }, [phone, code, router])

  return (
    <div className="w-full max-w-md mx-auto rounded-2xl border border-border p-6 flex flex-col gap-4"
      style={{ background: "var(--surface)" }}>
      <div>
        <h1 className="text-lg font-semibold text-foreground">绑定手机号</h1>
        <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
          微信登录拿不到手机号，而手机号是账号的唯一凭据 ——
          绑好之后，你用手机号或微信都能进同一个账号，学习记录不会分散在两处。
        </p>
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
        绑定并进入
      </Button>

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
    </div>
  )
}
