import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { withdrawalRequests, users } from "@/lib/db/schema"
import { getSession } from "@/lib/auth/session"
import { eq, desc } from "drizzle-orm"

export async function GET() {
  if (!db) return NextResponse.json({ error: "服务未配置" }, { status: 500 })

  const session = await getSession()
  if (!session) return NextResponse.json({ error: "请先登录" }, { status: 401 })

  const [partner] = await db
    .select({ isPartner: users.isPartner })
    .from(users)
    .where(eq(users.id, session.userId))
    .limit(1)

  if (!partner?.isPartner) {
    return NextResponse.json({ error: "您还不是合伙人" }, { status: 403 })
  }

  const data = await db
    .select()
    .from(withdrawalRequests)
    .where(eq(withdrawalRequests.partnerId, session.userId))
    .orderBy(desc(withdrawalRequests.createdAt))
    .limit(50)

  return NextResponse.json({ data })
}
