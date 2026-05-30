import { Suspense } from "react"
import { redirect } from "next/navigation"
import { getCurrentUser } from "@/lib/auth/user"
import { getActiveSubscription } from "@/lib/subscription"
import { SettingsClient } from "@/components/home/SettingsClient"

export default async function SettingsPage() {
  const user = await getCurrentUser()
  if (!user) redirect("/login")

  let memberTier: "trial" | "monthly" | "yearly" | "partner" | "free" = "free"
  if (user.isPartner) {
    memberTier = "partner"
  } else if (user.isPro) {
    const sub = await getActiveSubscription(user.id)
    memberTier = (sub?.plan as "monthly" | "yearly") ?? "trial"
  }

  return (
    <Suspense>
      <SettingsClient
        initialUser={{
          name: user.name ?? null,
          avatar: user.avatar ?? null,
          phone: user.phone ?? null,
          hasWechat: !!user.wechatOpenid,
          isPro: !!user.isPro,
          isPartner: !!user.isPartner,
          proExpires: user.proExpires?.toISOString() ?? null,
          memberTier,
        }}
      />
    </Suspense>
  )
}
