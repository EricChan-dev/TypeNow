import { redirect } from "next/navigation"
import { getUser, isDbConfigured } from "@/app/actions/auth"
import { getActiveSubscription } from "@/lib/subscription"
import { ConditionalTopbar } from "@/components/home/ConditionalTopbar"
import { HomeShell } from "@/components/home/HomeShell"
import { ExpiryWarningModal } from "@/components/home/ExpiryWarningModal"

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
      }
    : null

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-background">
      <ConditionalTopbar serverUser={serverUser} />
      <HomeShell isPartner={!!(serverUser?.is_partner)}>{children}</HomeShell>
      {serverUser && (
        <ExpiryWarningModal
          memberTier={serverUser.member_tier}
          proExpires={serverUser.pro_expires}
        />
      )}
    </div>
  )
}
