import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { partnerCommissions, users } from "@/lib/db/schema"
import { getSession } from "@/lib/auth/session"
import { eq, and, lte, sum, count, isNotNull } from "drizzle-orm"

export async function GET() {
  if (!db) return NextResponse.json({ error: "服务未配置" }, { status: 500 })

  const session = await getSession()
  if (!session) return NextResponse.json({ error: "请先登录" }, { status: 401 })

  const [partner] = await db
    .select({ isPartner: users.isPartner, inviteCode: users.inviteCode, wechatOpenid: users.wechatOpenid })
    .from(users)
    .where(eq(users.id, session.userId))
    .limit(1)

  if (!partner?.isPartner) {
    return NextResponse.json({ error: "您还不是合伙人" }, { status: 403 })
  }

  // Thaw cooling commissions that have passed available_at
  await db
    .update(partnerCommissions)
    .set({ status: "available" })
    .where(
      and(
        eq(partnerCommissions.partnerId, session.userId),
        eq(partnerCommissions.status, "cooling"),
        lte(partnerCommissions.availableAt, new Date())
      )
    )

  const commissions = await db
    .select({
      status: partnerCommissions.status,
      commissionAmount: partnerCommissions.commissionAmount,
    })
    .from(partnerCommissions)
    .where(eq(partnerCommissions.partnerId, session.userId))

  const totalEarned = commissions
    .filter((c) => c.status !== "clawed_back")
    .reduce((s, c) => s + c.commissionAmount, 0)

  const available = commissions
    .filter((c) => c.status === "available")
    .reduce((s, c) => s + c.commissionAmount, 0)

  const cooling = commissions
    .filter((c) => c.status === "cooling")
    .reduce((s, c) => s + c.commissionAmount, 0)

  // Referral stats
  const [referredCount] = await db
    .select({ cnt: count() })
    .from(users)
    .where(eq(users.referredBy, session.userId))

  const paidUsers = commissions
    .filter((c) => c.status !== "clawed_back")
    .map((c) => c.commissionAmount) // proxy for paid count (distinct referredUserId)

  // Distinct paid users count
  const distinctPaid = await db
    .selectDistinct({ referredUserId: partnerCommissions.referredUserId })
    .from(partnerCommissions)
    .where(
      and(
        eq(partnerCommissions.partnerId, session.userId),
        eq(partnerCommissions.commissionType, "first")
      )
    )

  return NextResponse.json({
    inviteCode: partner.inviteCode,
    hasWechat: !!partner.wechatOpenid,
    totalEarned,
    available,
    cooling,
    referredCount: referredCount.cnt,
    paidCount: distinctPaid.length,
  })
}
