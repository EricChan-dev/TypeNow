import { redirect } from "next/navigation"
import { getUser, isDbConfigured } from "@/app/actions/auth"
import { isDevBypassSession } from "@/lib/auth/session"
import { needsPhoneBinding } from "@/lib/phone-gate"
import { BindPhoneModal } from "@/components/auth/BindPhoneModal"
import { getActiveSubscription } from "@/lib/subscription"
import { ConditionalTopbar } from "@/components/home/ConditionalTopbar"
import { HomeShell } from "@/components/home/HomeShell"
import { ExpiryWarningModal } from "@/components/home/ExpiryWarningModal"
import { ExpiryBanner } from "@/components/home/ExpiryBanner"

export default async function HomeLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const dbReady = await isDbConfigured()
  const user = await getUser()

  if (dbReady && !user) {
    redirect("/login")
  }

  // 微信登录建号时拿不到手机号，而手机号是唯一能把"微信注册的号"和"手机号注册的号"
  // 认成同一个人的凭据 —— 不强制绑定，同一个人就会有两个账号。
  //
  // 这里只算出"要不要拦"，不在这里跳转：拦的方式是**盖一层不可关闭的弹窗**
  // （见下方渲染）。做成弹窗而不是独立页，是因为绑手机号是"做某件事之前的一道
  // 手续"，不是目的地 —— 独立页会把用户从当前上下文里拽走，绑完还得自己找回来。
  //
  // 仍然拦在"进站之前"：这时微信壳账号还没有任何练习数据，撞号时只需把微信身份
  // 转到手机号账号上，不必做数据合并（系统没有那个能力）。见 lib/phone-gate。
  const mustBindPhone =
    !!user && needsPhoneBinding({ phone: user.phone, devBypass: await isDevBypassSession() })

  let memberTier: "trial" | "monthly" | "yearly" | "partner" | "free" = "free"
  if (user) {
    if (user.isPartner) {
      memberTier = "partner"
    } else if (user.isPro) {
      const sub = await getActiveSubscription(user.id)
      memberTier = (sub?.plan as "monthly" | "yearly") ?? "trial"
    }
  }

  const serverUser = user
    ? {
        name: user.name || null,
        avatar: user.avatar || null,
        email: user.email || null,
        is_pro: !!user.isPro,
        is_partner: !!user.isPartner,
        level: user.level,
        member_tier: memberTier,
        pro_expires: user.proExpires?.toISOString() ?? null,
        diamonds: user.diamonds ?? 0,
        check_in_goal: user.checkInGoal ?? 50,
      }
    : null

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-background">
      <ConditionalTopbar serverUser={serverUser} />
      {serverUser && (
        <ExpiryBanner memberTier={serverUser.member_tier} proExpires={serverUser.pro_expires} />
      )}
      <HomeShell isPartner={!!(serverUser?.is_partner)}>{children}</HomeShell>
      {mustBindPhone && <BindPhoneModal />}
      {serverUser && (
        <ExpiryWarningModal
          memberTier={serverUser.member_tier}
          proExpires={serverUser.pro_expires}
        />
      )}
    </div>
  )
}
