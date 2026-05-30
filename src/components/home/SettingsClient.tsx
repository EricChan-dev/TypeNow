"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { animate, stagger } from "animejs"
import {
  Camera, Check, Loader2, Phone, Crown,
  ChevronRight, Smartphone, MessageCircle,
  ShieldCheck, ReceiptText, Sparkles, X, Plus,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import { BindWeChatQRCode } from "@/components/auth/BindWeChatQRCode"

// ─── Types ────────────────────────────────────────────────────────────────────

type MemberTier = "trial" | "monthly" | "yearly" | "partner" | "free"

interface InitialUser {
  name: string | null
  avatar: string | null
  phone: string | null
  hasWechat: boolean
  isPro: boolean
  isPartner: boolean
  proExpires: string | null
  memberTier: MemberTier
}

interface Sub {
  id: string
  plan: "monthly" | "yearly" | "partner"
  status: "active" | "cancelled" | "expired"
  startsAt: string
  expiresAt: string
}

// ─── Constants ────────────────────────────────────────────────────────────────

const TIER_LABEL: Record<MemberTier, string> = {
  trial:   "试用会员",
  monthly: "月度会员",
  yearly:  "年度会员",
  partner: "永久会员",
  free:    "普通用户",
}

const TIER_STYLE: Record<MemberTier, React.CSSProperties> = {
  trial:   { background: "rgba(251,191,36,0.12)", borderColor: "rgba(251,191,36,0.3)", color: "#fbbf24" },
  monthly: { background: "rgba(96,165,250,0.12)", borderColor: "rgba(96,165,250,0.3)", color: "#60a5fa" },
  yearly:  { background: "rgba(167,139,250,0.12)", borderColor: "rgba(167,139,250,0.3)", color: "#a78bfa" },
  partner: { background: "linear-gradient(135deg,rgba(251,191,36,0.2),rgba(234,179,8,0.1))", borderColor: "rgba(251,191,36,0.45)", color: "#fde047", boxShadow: "0 0 8px rgba(251,191,36,0.2)" },
  free:    { background: "rgba(255,255,255,0.06)", borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.4)" },
}

const PLAN_LABEL: Record<string, string> = {
  monthly: "月度会员",
  yearly:  "年度会员",
  partner: "合伙人（永久）",
}

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  active:    { label: "生效中",   className: "text-emerald-400 bg-emerald-400/10 border-emerald-400/20" },
  expired:   { label: "已到期",   className: "text-white/25 bg-white/[0.04] border-white/[0.08]" },
  cancelled: { label: "已取消",   className: "text-red-400/70 bg-red-400/10 border-red-400/20" },
}

// ─── Utility ──────────────────────────────────────────────────────────────────

function maskPhone(phone: string | null): string {
  if (!phone) return "未绑定"
  if (phone.length <= 7) return phone
  return phone.slice(0, 3) + " **** " + phone.slice(-4)
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" })
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      className="rounded-2xl border border-white/[0.07] overflow-hidden"
      style={{ background: "rgba(255,255,255,0.025)" }}
    >
      <div className="px-5 py-3 border-b border-white/[0.06]">
        <p className="text-[11px] font-semibold text-white/30 uppercase tracking-widest">{title}</p>
      </div>
      <div className="px-5 py-4 space-y-3">{children}</div>
    </div>
  )
}

function InfoRow({
  icon,
  label,
  value,
  badge,
  badgeOk,
}: {
  icon: React.ReactNode
  label: string
  value: string
  badge?: string
  badgeOk?: boolean
}) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-xl bg-white/[0.06] flex items-center justify-center shrink-0">
          {icon}
        </div>
        <div>
          <p className="text-[11px] text-white/30">{label}</p>
          <p className="text-sm text-white/70 font-medium mt-0.5">{value}</p>
        </div>
      </div>
      {badge && (
        <span
          className={cn(
            "text-[10px] font-semibold px-2 py-0.5 rounded-full border",
            badgeOk
              ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
              : "bg-amber-500/10 border-amber-500/20 text-amber-400"
          )}
        >
          {badge}
        </span>
      )}
    </div>
  )
}

function SubRow({ sub }: { sub: Sub }) {
  const cfg = STATUS_CONFIG[sub.status] ?? STATUS_CONFIG.expired
  const isPartner = sub.plan === "partner"
  return (
    <div className="flex items-center justify-between py-3 border-b border-white/[0.05] last:border-0">
      <div>
        <p className="text-sm font-medium text-white/70">{PLAN_LABEL[sub.plan]}</p>
        <p className="text-[11px] text-white/25 mt-0.5 font-mono">
          {fmtDate(sub.startsAt)}
          {isPartner ? " · 永久" : ` — ${fmtDate(sub.expiresAt)}`}
        </p>
      </div>
      <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded-full border", cfg.className)}>
        {cfg.label}
      </span>
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function SettingsClient({ initialUser }: { initialUser: InitialUser }) {
  const [name, setName] = useState(initialUser.name ?? "")
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [subs, setSubs] = useState<Sub[]>([])
  const [subsLoading, setSubsLoading] = useState(true)

  // Bind flow state
  const searchParams = useSearchParams()
  const [showPhoneBind, setShowPhoneBind] = useState(false)
  const [showWechatBind, setShowWechatBind] = useState(false)
  const [phoneValue, setPhoneValue] = useState("")
  const [codeValue, setCodeValue] = useState("")
  const [sendingCode, setSendingCode] = useState(false)
  const [codeCountdown, setCodeCountdown] = useState(0)
  const [binding, setBinding] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const pageRef = useRef<HTMLDivElement>(null)
  const saveRef = useRef<HTMLButtonElement>(null)

  // Handle bind result query params
  useEffect(() => {
    const bindSuccess = searchParams.get("bind_success")
    const bindError = searchParams.get("bind_error")

    if (bindSuccess === "wechat") {
      toast.success("微信绑定成功")
      // Delay reload so user sees the toast
      setTimeout(() => window.location.reload(), 800)
    }
    if (bindError) {
      const messages: Record<string, string> = {
        wechat_already_bound: "该微信已被其他账号绑定",
        already_has_wechat: "当前账号已绑定微信",
        not_logged_in: "绑定超时，请重新登录后再试",
        csrf_mismatch: "绑定验证失败，请重试",
      }
      toast.error(messages[bindError] ?? "绑定失败，请重试")
      // Clean URL param
      const url = new URL(window.location.href)
      url.searchParams.delete("bind_success")
      url.searchParams.delete("bind_error")
      window.history.replaceState({}, "", url.toString())
    }
  }, [searchParams])

  // Code countdown
  useEffect(() => {
    if (codeCountdown <= 0) return
    const timer = setInterval(() => setCodeCountdown((c) => c - 1), 1000)
    return () => clearInterval(timer)
  }, [codeCountdown])

  // Load subscriptions
  useEffect(() => {
    fetch("/api/user/subscriptions")
      .then((r) => r.json())
      .then((d) => setSubs(d.data ?? []))
      .catch(() => {})
      .finally(() => setSubsLoading(false))
  }, [])

  // Entrance animation
  useEffect(() => {
    if (!pageRef.current) return
    const cards = pageRef.current.querySelectorAll(".settings-card")
    animate(cards, {
      translateY: [20, 0],
      opacity: [0, 1],
      duration: 500,
      delay: stagger(70, { start: 60 }),
      ease: "out(3)",
    })
  }, [])

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 1.5 * 1024 * 1024) {
      toast.error("图片不能超过 1.5MB")
      return
    }
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      toast.error("仅支持 JPG / PNG / WebP")
      return
    }
    const reader = new FileReader()
    reader.onload = (ev) => setAvatarPreview(ev.target?.result as string)
    reader.readAsDataURL(file)
    // reset input so same file can be re-selected
    e.target.value = ""
  }

  const currentAvatar = avatarPreview ?? initialUser.avatar
  const displayName = initialUser.name ?? ""
  const nameChanged = name.trim() !== displayName
  const hasChanges = nameChanged || avatarPreview !== null

  const handleSave = useCallback(async () => {
    if (!hasChanges || saving) return
    setSaving(true)
    try {
      const body: Record<string, string> = {}
      if (nameChanged) body.name = name.trim()
      if (avatarPreview) body.avatar = avatarPreview

      const res = await fetch("/api/user/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "保存失败")

      // Button success pulse
      if (saveRef.current) {
        animate(saveRef.current, { scale: [1, 1.08, 1], duration: 400, ease: "out(2)" })
      }

      toast.success("保存成功")
      // Soft refresh to sync server state
      setTimeout(() => window.location.reload(), 600)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "保存失败，请重试")
    } finally {
      setSaving(false)
    }
  }, [hasChanges, saving, name, nameChanged, avatarPreview])

  // ─── Bind handlers ──────────────────────────────────────────────────────────

  const handleSendCode = useCallback(async () => {
    if (!/^1[3-9]\d{9}$/.test(phoneValue)) {
      toast.error("请输入有效的手机号")
      return
    }
    if (codeCountdown > 0) return
    setSendingCode(true)
    try {
      const res = await fetch("/api/auth/send-sms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: phoneValue }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "发送失败")
      toast.success("验证码已发送")
      setCodeCountdown(60)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "发送失败，请重试")
    } finally {
      setSendingCode(false)
    }
  }, [phoneValue, codeCountdown])

  const handleBindPhone = useCallback(async () => {
    if (!/^1[3-9]\d{9}$/.test(phoneValue)) {
      toast.error("请输入有效的手机号")
      return
    }
    if (codeValue.length !== 6) {
      toast.error("请输入6位验证码")
      return
    }
    setBinding(true)
    try {
      const res = await fetch("/api/auth/bind/phone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: phoneValue, code: codeValue }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "绑定失败")
      toast.success("手机号绑定成功")
      setTimeout(() => window.location.reload(), 800)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "绑定失败，请重试")
    } finally {
      setBinding(false)
    }
  }, [phoneValue, codeValue])

  const tier = initialUser.memberTier
  const tierStyle = TIER_STYLE[tier]

  return (
    <div ref={pageRef} className="h-full overflow-y-auto scrollbar-none">
      <div className="max-w-lg mx-auto px-4 sm:px-6 py-7 pb-16 space-y-4">

        {/* Header */}
        <div className="settings-card opacity-0 mb-6">
          <h1 className="text-xl font-bold text-white">账户设置</h1>
          <p className="text-white/30 text-sm mt-1">管理个人信息与订阅</p>
        </div>

        {/* Avatar + Profile */}
        <div
          className="settings-card opacity-0 rounded-2xl border border-white/[0.07] p-6"
          style={{ background: "rgba(255,255,255,0.025)" }}
        >
          {/* Avatar upload */}
          <div className="flex flex-col items-center gap-3 mb-6">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="relative group shrink-0"
            >
              <div className="w-20 h-20 rounded-full overflow-hidden border-2 border-white/[0.12] ring-4 ring-violet-500/15">
                {currentAvatar ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={currentAvatar}
                    alt="头像"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full bg-violet-500/20 flex items-center justify-center text-2xl font-bold text-violet-300">
                    {(displayName || "U")[0].toUpperCase()}
                  </div>
                )}
              </div>
              {/* Hover overlay */}
              <div className="absolute inset-0 rounded-full bg-black/55 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                <Camera className="h-6 w-6 text-white" />
              </div>
              {/* Preview indicator */}
              {avatarPreview && (
                <div className="absolute -bottom-0.5 -right-0.5 w-6 h-6 rounded-full bg-violet-500 border-2 border-black flex items-center justify-center">
                  <Sparkles className="h-3 w-3 text-white" />
                </div>
              )}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={handleFileChange}
            />
            <div className="text-center">
              <p className="text-[12px] text-white/30">点击更换头像</p>
              <p className="text-[10px] text-white/18 mt-0.5">JPG / PNG / WebP · 最大 1.5MB</p>
            </div>
            {avatarPreview && (
              <button
                onClick={() => setAvatarPreview(null)}
                className="text-[11px] text-white/25 hover:text-white/45 transition-colors"
              >
                撤销头像更改
              </button>
            )}
          </div>

          {/* Name input */}
          <div className="space-y-2">
            <label className="text-[11px] text-white/35 font-medium uppercase tracking-wider block">
              昵称
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={50}
              placeholder="输入昵称"
              className="w-full bg-white/[0.05] border border-white/[0.1] rounded-xl px-4 py-3 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/30 transition-all"
            />
          </div>

          {/* Save button */}
          <button
            ref={saveRef}
            onClick={handleSave}
            disabled={!hasChanges || saving}
            className={cn(
              "mt-4 w-full py-3 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-all duration-200",
              hasChanges && !saving
                ? "text-white active:scale-[0.98]"
                : "text-white/20 cursor-default"
            )}
            style={
              hasChanges
                ? {
                    background: "linear-gradient(135deg, #7c3aed, #a855f7)",
                    boxShadow: "0 0 20px rgba(124,58,237,0.3)",
                  }
                : { background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.07)" }
            }
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Check className="h-4 w-4" />
            )}
            {saving ? "保存中…" : "保存修改"}
          </button>
        </div>

        {/* Account security */}
        <SectionCard title="账号安全">
          {/* Phone row */}
          <div className="flex items-center justify-between py-0.5">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-white/[0.06] flex items-center justify-center shrink-0">
                <Phone className="h-3.5 w-3.5 text-blue-400" />
              </div>
              <div>
                <p className="text-[11px] text-white/30">手机号</p>
                <p className="text-sm text-white/70 font-medium mt-0.5">{maskPhone(initialUser.phone)}</p>
              </div>
            </div>
            {initialUser.phone ? (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border bg-emerald-500/10 border-emerald-500/20 text-emerald-400">
                已绑定
              </span>
            ) : (
              <button
                onClick={() => setShowPhoneBind(!showPhoneBind)}
                className="flex items-center gap-1 text-[11px] font-medium text-violet-400 hover:text-violet-300 transition-colors"
              >
                <Plus className="h-3 w-3" />
                绑定手机号
              </button>
            )}
          </div>

          {/* Phone bind form (expandable) */}
          {showPhoneBind && (
            <div className="space-y-3 pt-1 pb-2">
              <div className="flex items-center gap-2">
                <span className="text-xs text-white/30 shrink-0">+86</span>
                <input
                  value={phoneValue}
                  onChange={(e) => setPhoneValue(e.target.value.replace(/\D/g, ""))}
                  maxLength={11}
                  placeholder="输入手机号"
                  className="flex-1 bg-white/[0.05] border border-white/[0.1] rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-violet-500/50 transition-all"
                />
              </div>
              <div className="flex items-center gap-2">
                <input
                  value={codeValue}
                  onChange={(e) => setCodeValue(e.target.value.replace(/\D/g, ""))}
                  maxLength={6}
                  placeholder="验证码"
                  className="flex-1 bg-white/[0.05] border border-white/[0.1] rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-violet-500/50 transition-all"
                />
                <button
                  onClick={handleSendCode}
                  disabled={sendingCode || codeCountdown > 0}
                  className={cn(
                    "shrink-0 px-3 py-2 rounded-lg text-[11px] font-medium transition-all",
                    codeCountdown > 0
                      ? "text-white/20 bg-white/[0.05]"
                      : "text-violet-400 bg-violet-500/10 hover:bg-violet-500/20"
                  )}
                >
                  {sendingCode ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> :
                   codeCountdown > 0 ? `${codeCountdown}s` : "发送验证码"}
                </button>
              </div>
              <button
                onClick={handleBindPhone}
                disabled={binding}
                className="w-full py-2.5 rounded-xl text-sm font-semibold text-white flex items-center justify-center gap-2 transition-all"
                style={{
                  background: "linear-gradient(135deg, #7c3aed, #a855f7)",
                  boxShadow: "0 0 16px rgba(124,58,237,0.25)",
                }}
              >
                {binding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                确认绑定
              </button>
            </div>
          )}

          <div className="h-px bg-white/[0.05]" />

          {/* WeChat row */}
          <div className="flex items-center justify-between py-0.5">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-white/[0.06] flex items-center justify-center shrink-0">
                <MessageCircle className="h-3.5 w-3.5 text-green-400" />
              </div>
              <div>
                <p className="text-[11px] text-white/30">微信账号</p>
                <p className="text-sm text-white/70 font-medium mt-0.5">{initialUser.hasWechat ? "已绑定" : "未绑定"}</p>
              </div>
            </div>
            {initialUser.hasWechat ? (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border bg-emerald-500/10 border-emerald-500/20 text-emerald-400">
                已绑定
              </span>
            ) : (
              <button
                onClick={() => setShowWechatBind(true)}
                className="flex items-center gap-1 text-[11px] font-medium text-green-400 hover:text-green-300 transition-colors"
              >
                <Plus className="h-3 w-3" />
                绑定微信
              </button>
            )}
          </div>
        </SectionCard>

        {/* WeChat bind modal */}
        {showWechatBind && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/60" onClick={() => setShowWechatBind(false)} />
            <div
              className="relative rounded-2xl border border-white/[0.1] p-6 w-full max-w-sm"
              style={{ background: "#1a1a1a" }}
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-white">绑定微信账号</h3>
                <button
                  onClick={() => setShowWechatBind(false)}
                  className="w-7 h-7 rounded-lg bg-white/[0.06] flex items-center justify-center hover:bg-white/[0.1] transition-colors"
                >
                  <X className="h-3.5 w-3.5 text-white/50" />
                </button>
              </div>
              <BindWeChatQRCode />
            </div>
          </div>
        )}

        {/* Membership */}
        <SectionCard title="会员信息">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-white/70">当前套餐</p>
              {initialUser.proExpires && !initialUser.isPartner && (
                <p className="text-[11px] text-white/30 mt-0.5">
                  到期：{fmtDate(initialUser.proExpires)}
                </p>
              )}
              {initialUser.isPartner && (
                <p className="text-[11px] text-white/30 mt-0.5">永久有效</p>
              )}
            </div>
            <span
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[12px] font-semibold border"
              style={tierStyle}
            >
              {tier === "partner" && <ShieldCheck className="h-3 w-3" />}
              {tier === "yearly" && <Crown className="h-3 w-3" />}
              {TIER_LABEL[tier]}
            </span>
          </div>

          {!initialUser.isPro && !initialUser.isPartner && (
            <>
              <div className="h-px bg-white/[0.05]" />
              <Link
                href="/pricing"
                className="flex items-center justify-between w-full rounded-xl bg-violet-500/10 border border-violet-500/20 px-4 py-3 hover:bg-violet-500/15 transition-colors"
              >
                <div className="flex items-center gap-2.5">
                  <Crown className="h-4 w-4 text-violet-400" />
                  <span className="text-sm font-medium text-violet-300">升级会员，解锁全部课程</span>
                </div>
                <ChevronRight className="h-4 w-4 text-violet-400/60" />
              </Link>
            </>
          )}
        </SectionCard>

        {/* Subscription history */}
        <SectionCard title="订阅记录">
          {subsLoading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-4 w-4 text-white/30 animate-spin" />
            </div>
          ) : subs.length === 0 ? (
            <div className="flex flex-col items-center py-8 gap-2">
              <ReceiptText className="h-8 w-8 text-white/10" />
              <p className="text-sm text-white/25">暂无订阅记录</p>
            </div>
          ) : (
            <div>
              {subs.map((sub) => (
                <SubRow key={sub.id} sub={sub} />
              ))}
            </div>
          )}
        </SectionCard>

        {/* Sign out hint */}
        <div className="settings-card opacity-0 flex justify-center pt-2">
          <p className="text-[11px] text-white/15">如需注销账号，请联系客服</p>
        </div>

      </div>
    </div>
  )
}
