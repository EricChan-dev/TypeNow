import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { withdrawalRequests, users } from "@/lib/db/schema"
import { getSession } from "@/lib/auth/session"
import { eq, desc } from "drizzle-orm"

export async function GET() {
  if (!db) return NextResponse.json({ error: "服务未配置" }, { status: 500 })

  const session = await getSession()
  if (!session) return NextResponse.json({ error: "请先登录" }, { status: 401 })

  // ⚠️ 门禁依据在 2026-10-10 重新变回 `is_partner`（= 付过 ¥699 合伙人版）。
  //
  // 2026-09-29 曾把它改成「免费同意《推广合作协议》即可」（partner_agreed_at），
  // 理由就是「付费取得推广资格」命中《禁止传销条例》第七条(二)「变相入门费」，
  // 那是当年自查九个要件里唯一命中的一条。
  //
  // 现在为对齐句游英语的合伙人版改回付费门禁，法律风险随之恢复。
  // 这对应 docs/distribution-compliance.md:27-28 的复核触发条件
  // （「把推广资格与任何付费商品重新绑定」→ 改代码前先找律师），复核尚未进行；
  // 决策方已书面确认承担风险。见 docs/membership-alignment-risk-2026-10.md。
  const [promoter] = await db
    .select({ isPartner: users.isPartner })
    .from(users)
    .where(eq(users.id, session.userId))
    .limit(1)

  if (!promoter) {
    return NextResponse.json({ error: "账号不存在" }, { status: 403 })
  }
  if (!promoter.isPartner) {
    return NextResponse.json({ error: "请先开通合伙人版" }, { status: 403 })
  }

  const data = await db
    .select()
    .from(withdrawalRequests)
    .where(eq(withdrawalRequests.partnerId, session.userId))
    .orderBy(desc(withdrawalRequests.createdAt))
    .limit(50)

  return NextResponse.json({ data })
}
