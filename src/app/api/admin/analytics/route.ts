import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { analyticsEvents } from "@/lib/db/schema"
import { requireAdmin } from "@/lib/admin-auth"
import { sql, desc, gte, eq } from "drizzle-orm"

export async function GET(request: Request) {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth
  if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })

  const { searchParams } = new URL(request.url)
  const page = Number(searchParams.get("current") ?? "1")
  const pageSize = Number(searchParams.get("pageSize") ?? "50")
  const offset = (page - 1) * pageSize

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

  const [rows, [{ total }], [{ todayCount }], [{ weekCount }], pageViewRows] = await Promise.all([
    db.select().from(analyticsEvents).orderBy(desc(analyticsEvents.createdAt)).limit(pageSize).offset(offset),
    db.select({ total: sql<number>`count(*)` }).from(analyticsEvents),
    db.select({ todayCount: sql<number>`count(*)` }).from(analyticsEvents).where(gte(analyticsEvents.createdAt, today)),
    db.select({ weekCount: sql<number>`count(*)` }).from(analyticsEvents).where(gte(analyticsEvents.createdAt, weekAgo)),
    db
      .select({ properties: analyticsEvents.properties })
      .from(analyticsEvents)
      .where(eq(analyticsEvents.eventType, "page_view"))
      .orderBy(desc(analyticsEvents.createdAt))
      .limit(1000),
  ])

  const pageCounts: Record<string, number> = {}
  for (const row of pageViewRows) {
    const props = row.properties as Record<string, string> | null
    const page = props?.page || "/"
    pageCounts[page] = (pageCounts[page] || 0) + 1
  }
  const topPages = Object.entries(pageCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([page, count]) => ({ page, count }))

  return NextResponse.json({ data: rows, total, todayEvents: todayCount, weekEvents: weekCount, topPages })
}
