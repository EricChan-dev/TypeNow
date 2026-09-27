import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { analyticsEvents, users } from "@/lib/db/schema"
import { requireAdmin } from "@/lib/admin-auth"
import { activeProSql } from "@/lib/subscription"
import { parsePagination } from "@/lib/pagination"
import { buildEventWhere, parseEventFilter } from "@/lib/admin-event-filter"
import { maskPhone } from "@/lib/mask"
import { desc, eq, sql } from "drizzle-orm"

/**
 * 埋点明细列表（后台「埋点分析」页的表格）。
 *
 * 这是整个埋点分析的落点：任何一张报表上的数字，最终都要能点到这里，
 * 看到"这个数是由哪些具体记录组成的"。所以：
 *   - 筛选维度与 /api/admin/events/stats 完全一致（共用 admin-event-filter），
 *     否则表格和图表会对不上；
 *   - LEFT JOIN users 带出是谁，未登录的记为匿名 —— 匿名流量是漏斗第一段，
 *     不能因为 JOIN 不上就把它过滤掉（那样总量会凭空变少）。
 *
 * 返回 refine 的列表契约 { data, total }，字段保持驼峰（选出来的别名）。
 */
export async function GET(request: Request) {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth
  if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })

  const { searchParams } = new URL(request.url)
  const { pageSize, offset } = parsePagination(searchParams, 20)
  const filter = parseEventFilter(searchParams)
  const where = buildEventWhere(filter)

  const [rows, countRow] = await Promise.all([
    db
      .select({
        id: analyticsEvents.id,
        eventType: analyticsEvents.eventType,
        userId: analyticsEvents.userId,
        pageUrl: analyticsEvents.pageUrl,
        sessionId: analyticsEvents.sessionId,
        properties: analyticsEvents.properties,
        createdAt: analyticsEvents.createdAt,
        userName: users.name,
        userPhone: users.phone,
        userIsPro: activeProSql(),
      })
      .from(analyticsEvents)
      // LEFT JOIN：匿名事件 userId 为 NULL，INNER JOIN 会静默丢掉它们
      .leftJoin(users, eq(analyticsEvents.userId, users.id))
      .where(where)
      // 同一毫秒可能有大量事件（比如页面初始化一次发好几条），
      // 只按时间排序时翻页边界不稳定，会重复或漏记录；id 兜底保证全序
      .orderBy(desc(analyticsEvents.createdAt), desc(analyticsEvents.id))
      .limit(pageSize)
      .offset(offset),

    db.select({ total: sql<number>`count(*)` }).from(analyticsEvents).where(where),
  ])

  return NextResponse.json({
    data: rows.map((r) => ({
      id: String(r.id),
      eventType: r.eventType,
      userId: r.userId,
      userName: r.userName ?? null,
      userPhone: maskPhone(r.userPhone),
      userIsPro: r.userIsPro ?? null,
      pageUrl: r.pageUrl,
      sessionId: r.sessionId,
      properties: r.properties,
      createdAt: r.createdAt,
    })),
    total: Number(countRow[0]?.total ?? 0),
  })
}
