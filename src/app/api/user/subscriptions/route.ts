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
    .orderBy(desc(subscriptions.createdAt))
    .limit(20)

  return NextResponse.json({
    data: rows.map((r) => ({
      ...r,
      startsAt: r.startsAt?.toISOString() ?? "",
      expiresAt: r.expiresAt?.toISOString() ?? "",
    })),
  })
}
