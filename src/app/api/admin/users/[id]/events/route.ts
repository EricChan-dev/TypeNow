import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { analyticsEvents } from "@/lib/db/schema"
import { requireAdmin } from "@/lib/admin-auth"
import { parsePagination } from "@/lib/pagination"
import { and, desc, eq, sql, type SQL } from "drizzle-orm"

/**
 * 某个用户的埋点记录（后台用户详情页的「他到底干了什么」）。
 *
 * 这是「从报表/列表钻取到具体人」的落点：支付订单与用户列表都能点进用户详情，
 * 详情页再把这个人产生过的埋点按时间倒序列出来。
 *
 * 支持按事件类型过滤（`event` 参数），这样从漏斗某一步也能直接跳过来看明细。
 * 返回驼峰字段，properties 原样带上（它是自由 JSON，界面负责折叠展示）。
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth
  if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })

  const { id } = await params
  const { searchParams } = new URL(request.url)
  const { pageSize, offset } = parsePagination(searchParams, 20)
  const event = (searchParams.get("event") ?? "").trim().slice(0, 100)

  const where: SQL | undefined = event
    ? and(eq(analyticsEvents.userId, id), eq(analyticsEvents.eventType, event))
    : eq(analyticsEvents.userId, id)

  const [rows, [{ total }]] = await Promise.all([
    db
      .select()
      .from(analyticsEvents)
      .where(where)
      .orderBy(desc(analyticsEvents.createdAt))
      .limit(pageSize)
      .offset(offset),
    db.select({ total: sql<number>`count(*)` }).from(analyticsEvents).where(where),
  ])

  return NextResponse.json({ data: rows, total: Number(total) })
}
