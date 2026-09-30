import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { partnerCommissions, users } from "@/lib/db/schema"
import { getSession } from "@/lib/auth/session"
import { eq, and, lte, sum, count, isNotNull, ne } from "drizzle-orm"

export async function GET() {
  if (!db) return NextResponse.json({ error: "服务未配置" }, { status: 500 })

  const session = await getSession()
  if (!session) return NextResponse.json({ error: "请先登录" }, { status: 401 })

  // 门禁依据是**免费主动同意《推广合作协议》**（partner_agreed_at），不是付费。
  //
  // 改造前这里看 `is_partner`（= 买过 ¥499），等于「付费才能取得推广资格」，
  // 命中《禁止传销条例》第七条(二)。同意协议免费，所以拿它当门禁安全。
  //
  // 这里仍要查 inviteCode / wechatOpenid：**邀请码在注册时就已经为每个人生成**
  // （见 api/auth/verify-code 等三处），也就是说推广工具一直对全量用户可用 ——
  // 过去缺的只是「佣金准入」这一道门。这也正是本次改动量很小的原因。
  const [promoter] = await db
    .select({
      partnerAgreedAt: users.partnerAgreedAt,
      inviteCode: users.inviteCode,
      wechatOpenid: users.wechatOpenid,
    })
    .from(users)
    .where(eq(users.id, session.userId))
    .limit(1)

  if (!promoter) {
    return NextResponse.json({ error: "账号不存在" }, { status: 403 })
  }
  if (!promoter.partnerAgreedAt) {
    return NextResponse.json({ error: "请先加入推广计划" }, { status: 403 })
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

  // Distinct paid users count.
  //
  // 必须排掉 `clawed_back`：被退款扣回的人已经不算付费用户了。
  // 此前这里没有这个条件，于是退款后 `paidCount` 仍然算他一分 ——
  // 而 `/api/partner/invites` 的列表口径是"非 clawed_back 的 first 佣金"，
  // 两个数会对不上（列表说未付费、统计说付费），推广员会先怀疑平台在克扣。
  const distinctPaid = await db
    .selectDistinct({ referredUserId: partnerCommissions.referredUserId })
    .from(partnerCommissions)
    .where(
      and(
        eq(partnerCommissions.partnerId, session.userId),
        eq(partnerCommissions.commissionType, "first"),
        ne(partnerCommissions.status, "clawed_back")
      )
    )

  return NextResponse.json({
    inviteCode: promoter.inviteCode,
    hasWechat: !!promoter.wechatOpenid,
    totalEarned,
    available,
    cooling,
    referredCount: referredCount.cnt,
    paidCount: distinctPaid.length,
  })
}
