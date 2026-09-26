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

  // Ensure pro status is current. 上面的 user 是回收前的快照，必须以返回值修正，
  // 否则刚过期的用户会拿到一次 is_pro:true / member_tier:"trial" 的错误响应。
  const revoked = await checkAndExpirePro(user.id)
  const isPro = revoked ? false : !!user.isPro

  const isAdmin = user.role === "admin" || (user.phone != null && getAdminPhones().includes(user.phone))

  let memberTier: "trial" | "monthly" | "yearly" | "partner" | "free" = "free"
  if (user.isPartner) {
    memberTier = "partner"
  } else if (isPro) {
    const sub = await getActiveSubscription(user.id)
    memberTier = (sub?.plan as "monthly" | "yearly") ?? "trial"
  }

  return NextResponse.json({
    user: {
      id: user.id,
      name: user.name,
      avatar: user.avatar,
      is_pro: isPro,
      is_partner: !!user.isPartner,
      /**
       * 是否还能领取体验会员：当前不是会员、且从未领过（按手机号一次）。
       * 前端据此决定给「免费领取体验会员」还是「开通会员」这两个不同的入口。
       */
      trial_available: !isPro && user.trialClaimedAt == null,
      level: user.level,
      member_tier: memberTier,
      role: isAdmin ? "admin" : (user.role ?? "user"),
    },
  })
}
