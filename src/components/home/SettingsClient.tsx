"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import Link from "next/link"
import { animate, stagger } from "animejs"
import {
  Camera, Check, Loader2, Phone, Crown,
  ChevronRight, Smartphone, MessageCircle,
  ShieldCheck, ReceiptText, Sparkles,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { toast } from "sonner"

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

  const fileInputRef = useRef<HTMLInputElement>(null)
  const pageRef = useRef<HTMLDivElement>(null)
  const saveRef = useRef<HTMLButtonElement>(null)

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
          <InfoRow
            icon={<Phone className="h-3.5 w-3.5 text-blue-400" />}
            label="手机号"
            value={maskPhone(initialUser.phone)}
            badge={initialUser.phone ? "已绑定" : "未绑定"}
            badgeOk={!!initialUser.phone}
          />
          <div className="h-px bg-white/[0.05]" />
          <InfoRow
            icon={<MessageCircle className="h-3.5 w-3.5 text-green-400" />}
            label="微信账号"
            value={initialUser.hasWechat ? "已绑定" : "未绑定"}
            badge={initialUser.hasWechat ? "已绑定" : undefined}
            badgeOk
          />
        </SectionCard>

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
