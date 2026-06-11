import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/user"
import { getActiveSubscription, checkAndExpirePro } from "@/lib/subscription"

function getAdminPhones(): string[] {
  if (process.env.NODE_ENV === "development") {
    return ["16634482010"]
  }
  const raw = process.env.ADMIN_PHONES
  if (raw) return raw.split(",").map((s) => s.trim()).filter(Boolean)
  return []
}

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ user: null })

  // Ensure pro status is current
  await checkAndExpirePro(user.id)

  const isAdmin = user.role === "admin" || (user.phone != null && getAdminPhones().includes(user.phone))

  let memberTier: "trial" | "monthly" | "yearly" | "partner" | "free" = "free"
  if (user.isPartner) {
    memberTier = "partner"
  } else if (user.isPro) {
    const sub = await getActiveSubscription(user.id)
    memberTier = (sub?.plan as "monthly" | "yearly") ?? "trial"
  }

  return NextResponse.json({
    user: {
      id: user.id,
      name: user.name,
      avatar: user.avatar,
      is_pro: !!user.isPro,
      is_partner: !!user.isPartner,
      level: user.level,
      member_tier: memberTier,
      role: isAdmin ? "admin" : (user.role ?? "user"),
    },
  })
}
