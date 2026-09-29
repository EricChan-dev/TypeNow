import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { withdrawalRequests, users } from "@/lib/db/schema"
import { getSession } from "@/lib/auth/session"
import { eq, desc } from "drizzle-orm"

export async function GET() {
  if (!db) return NextResponse.json({ error: "服务未配置" }, { status: 500 })

  const session = await getSession()
  if (!session) return NextResponse.json({ error: "请先登录" }, { status: 401 })

  // 门禁依据是**免费主动同意《推广合作协议》**（partner_agreed_at），不是付费 ——
  // 「付费才能取得推广资格」命中《禁止传销条例》第七条(二)。
  // 见 docs/distribution-compliance.md。
  const [promoter] = await db
    .select({ partnerAgreedAt: users.partnerAgreedAt })
    .from(users)
    .where(eq(users.id, session.userId))
    .limit(1)

  if (!promoter) {
    return NextResponse.json({ error: "账号不存在" }, { status: 403 })
  }
  if (!promoter.partnerAgreedAt) {
    return NextResponse.json({ error: "请先加入推广计划" }, { status: 403 })
  }

  const data = await db
    .select()
    .from(withdrawalRequests)
    .where(eq(withdrawalRequests.partnerId, session.userId))
    .orderBy(desc(withdrawalRequests.createdAt))
    .limit(50)

  return NextResponse.json({ data })
}
