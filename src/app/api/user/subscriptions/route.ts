import { NextResponse } from "next/server"
import { getSession } from "@/lib/auth/session"
import { db } from "@/lib/db"
import { subscriptions } from "@/lib/db/schema"
import { eq, desc } from "drizzle-orm"

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })

  const rows = await db
    .select({
      id: subscriptions.id,
      plan: subscriptions.plan,
      status: subscriptions.status,
      startsAt: subscriptions.startsAt,
      expiresAt: subscriptions.expiresAt,
    })
    .from(subscriptions)
    .where(eq(subscriptions.userId, session.userId))
    // created_at 只精确到秒，同一秒内的多次开通会产生并列，MySQL 此时不保证顺序。
    // 用 expires_at 作为稳定的二级排序：并列时到期更晚的那条（最新叠加的权益）在前。
    .orderBy(desc(subscriptions.createdAt), desc(subscriptions.expiresAt))
    .limit(20)

  return NextResponse.json({
    data: rows.map((r) => ({
      ...r,
      startsAt: r.startsAt?.toISOString() ?? "",
      expiresAt: r.expiresAt?.toISOString() ?? "",
    })),
  })
}
