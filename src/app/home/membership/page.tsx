import { redirect } from "next/navigation"
import Link from "next/link"
import Image from "next/image"
import { getUser } from "@/app/actions/auth"
import { getActiveSubscription } from "@/lib/subscription"
import { Crown, CalendarDays, ChevronRight, Handshake } from "lucide-react"
import { MembershipHistory } from "./MembershipHistory"

type MemberTier = "trial" | "monthly" | "yearly" | "partner" | "free"

const TIER_LABELS: Record<MemberTier, string> = {
  free: "普通用户",
  trial: "体验会员",
  monthly: "月度会员",
  yearly: "年度会员",
  partner: "永久会员·合伙人",
}

const TIER_COLORS: Record<MemberTier, string> = {
  free: "bg-muted text-muted-foreground border border-transparent",
  trial: "bg-amber-500/20 text-amber-500 border border-amber-400/60",
  monthly: "bg-blue-500/20 text-blue-500 border border-blue-400/60",
  yearly: "bg-violet-500/20 text-violet-500 border border-violet-400/60",
  partner: "text-primary-foreground border",
}

function formatDate(d: Date | null): string {
  if (!d) return "—"
  return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日`
}

export default async function MembershipPage() {
  const user = await getUser()
  if (!user) redirect("/login")

  let memberTier: MemberTier = "free"
  if (user.isPartner) memberTier = "partner"
  else if (user.isPro) {
    const sub = await getActiveSubscription(user.id)
    memberTier = (sub?.plan as "monthly" | "yearly") ?? "trial"
  }

  const isPartner = memberTier === "partner"
  const isPro = user.isPro

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
      <h1 className="text-2xl font-bold text-foreground">会员中心</h1>

      {/* Current status */}
      <div className="rounded-2xl border border-border bg-card p-6 space-y-4">
        <div className="flex items-center gap-3">
          {!isPartner && (
            <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-muted">
              <Crown className="h-5 w-5 text-amber-500" />
            </div>
          )}
          {isPartner && (
            <div
              className="flex items-center justify-center w-10 h-10 rounded-xl"
              style={{ background: "linear-gradient(135deg, #b45309, #f59e0b)" }}
            >
              <Image src="/VIP.png" alt="VIP" width={24} height={24} />
            </div>
          )}
          <div>
            <p className="text-xs text-muted-foreground mb-1">当前身份</p>
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${TIER_COLORS[memberTier]}`}
              style={isPartner ? { background: "linear-gradient(135deg, #b45309 0%, #d97706 60%, #f59e0b 100%)", borderColor: "rgba(251,191,36,0.6)" } : undefined}
            >
              {memberTier !== "free" && (
                <Image src="/VIP.png" alt="VIP" width={13} height={13} className="shrink-0" />
              )}
              {TIER_LABELS[memberTier]}
            </span>
          </div>
        </div>

        {isPartner ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <CalendarDays className="h-4 w-4 shrink-0" />
            <span>永久有效，无需续费</span>
          </div>
        ) : isPro && user.proExpires ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <CalendarDays className="h-4 w-4 shrink-0" />
            <span>到期时间：{formatDate(user.proExpires)}</span>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">暂无会员权益</p>
        )}
      </div>

      {/* Pricing options */}
      {!isPartner && (
        <div className="rounded-2xl border border-border bg-card p-6 space-y-4">
          <h2 className="text-base font-semibold text-foreground">{isPro ? "提前续费" : "开通会员"}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Monthly */}
            <Link
              href="/pricing"
              className="relative rounded-xl border border-border p-4 hover:border-violet-500/50 hover:bg-muted/50 transition-colors group"
            >
              <p className="text-sm font-semibold text-foreground">月度会员</p>
              <p className="text-2xl font-bold text-foreground mt-1">
                ¥29<span className="text-sm font-normal text-muted-foreground"> / 月</span>
              </p>
              <ChevronRight className="absolute right-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
            </Link>

            {/* Yearly */}
            <Link
              href="/pricing"
              className="relative rounded-xl border border-violet-500/40 bg-violet-500/5 p-4 hover:border-violet-500/70 hover:bg-violet-500/10 transition-colors group"
            >
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-foreground">年度会员</p>
                <span className="text-[10px] font-bold bg-accent text-primary-foreground px-1.5 py-0.5 rounded-full">推荐</span>
              </div>
              <p className="text-2xl font-bold text-foreground mt-1">
                ¥199<span className="text-sm font-normal text-muted-foreground"> / 年</span>
              </p>
              <p className="text-xs text-violet-500 font-medium mt-1">相比月度节省 ¥149</p>
              <p className="text-[11px] text-muted-foreground line-through">月度 ×12 = ¥348</p>
              <ChevronRight className="absolute right-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground group-hover:text-violet-500 transition-colors" />
            </Link>
          </div>

          <Link
            href="/pricing"
            className="flex items-center justify-center w-full py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90"
            style={{ background: "linear-gradient(135deg, #7c3aed, #a855f7)" }}
          >
            查看全部套餐
          </Link>
        </div>
      )}

      {/* Partner CTA */}
      {!isPartner && (
        <Link
          href="/home/partner"
          className="flex items-center justify-between rounded-2xl border border-amber-500/30 bg-amber-500/5 p-5 hover:bg-amber-500/10 transition-colors group"
        >
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-amber-500/15">
              <Handshake className="h-5 w-5 text-amber-500" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">加入合伙人计划</p>
              <p className="text-xs text-muted-foreground mt-0.5">推广赚佣金，最高 50%</p>
            </div>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-amber-500 transition-colors" />
        </Link>
      )}

      {/* Subscription history */}
      <div className="rounded-2xl border border-border bg-card p-6 space-y-4">
        <h2 className="text-base font-semibold text-foreground">订阅记录</h2>
        <MembershipHistory />
      </div>
    </div>
  )
}
