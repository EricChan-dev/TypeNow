import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { analyticsEvents, users } from "@/lib/db/schema"
import { requireAdmin } from "@/lib/admin-auth"
import { maskPhone } from "@/lib/mask"
import { and, asc, desc, eq, gt, lt, sql } from "drizzle-orm"

/**
 * 单条埋点详情（后台「埋点详情」页）。
 *
 * 除了记录本身，还返回两样东西 —— 这两样才是排查时真正需要的：
 *
 * 1. `user`：这条事件属于谁。埋点表只存 user_id，不 JOIN 的话详情页
 *    只有一串 UUID，看不出是人还是匿名流量。
 * 2. `context`：同一用户（或同一 session，匿名时）在这条事件**前后各 15 条**。
 *    单看一条 click 没有意义，要看它前面的 page_view 和后面的
 *    click_subscribe 才能还原用户当时在干什么。
 *
 * 匿名事件没有 userId，退化成按 sessionId 取上下文；两者都没有就只返回记录本身。
 */
const CONTEXT_LIMIT = 15

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth
  if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })

  const { id } = await params
  const eventId = Number(id)
  // bigint 主键：非数字会让 MySQL 在隐式转换时把整个表当字符串比较，
  // 直接 400 比让它扫全表好
  if (!Number.isSafeInteger(eventId) || eventId <= 0) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 })
  }

  const [row] = await db
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
      userIsPro: users.isPro,
      userCreatedAt: users.createdAt,
      userReferredBy: users.referredBy,
    })
    .from(analyticsEvents)
    .leftJoin(users, eq(analyticsEvents.userId, users.id))
    .where(eq(analyticsEvents.id, eventId))
    .limit(1)

  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 })

  // 上下文：优先按用户，匿名时按 session
  const scope = row.userId
    ? eq(analyticsEvents.userId, row.userId)
    : row.sessionId
      ? eq(analyticsEvents.sessionId, row.sessionId)
      : null

  const context = scope
    ? (
        await Promise.all([
          db
            .select({
              id: analyticsEvents.id,
              eventType: analyticsEvents.eventType,
              pageUrl: analyticsEvents.pageUrl,
              properties: analyticsEvents.properties,
              createdAt: analyticsEvents.createdAt,
              userId: analyticsEvents.userId,
            })
            .from(analyticsEvents)
            .where(and(scope, lt(analyticsEvents.id, eventId)))
            .orderBy(desc(analyticsEvents.id))
            .limit(CONTEXT_LIMIT),
          db
            .select({
              id: analyticsEvents.id,
              eventType: analyticsEvents.eventType,
              pageUrl: analyticsEvents.pageUrl,
              properties: analyticsEvents.properties,
              createdAt: analyticsEvents.createdAt,
              userId: analyticsEvents.userId,
            })
            .from(analyticsEvents)
            .where(and(scope, gt(analyticsEvents.id, eventId)))
            .orderBy(asc(analyticsEvents.id))
            .limit(CONTEXT_LIMIT),
        ])
      ).flat()
    : []

  // 该用户的埋点总数：详情页要显示"这是他的第几条"
  const userEventCount = row.userId
    ? await db
        .select({ n: sql<number>`COUNT(*)` })
        .from(analyticsEvents)
        .where(eq(analyticsEvents.userId, row.userId))
        .then((r) => Number(r[0]?.n ?? 0))
    : 0

  return NextResponse.json({
    data: {
      id: String(row.id),
      eventType: row.eventType,
      userId: row.userId,
      pageUrl: row.pageUrl,
      sessionId: row.sessionId,
      properties: row.properties,
      createdAt: row.createdAt,
      // 上下文按 id 数值排序：id 是 bigint，转成字符串后 "10" < "9"，
      // 字典序排出来的时间线是乱的
      context: context
        .map((c) => ({ ...c, id: String(c.id), isCurrent: false }))
        .sort((a, b) => Number(a.id) - Number(b.id)),
      user: row.userId
        ? {
            id: row.userId,
            name: row.userName,
            phone: maskPhone(row.userPhone),
            isPro: row.userIsPro ?? 0,
            createdAt: row.userCreatedAt,
            referredBy: row.userReferredBy,
            eventCount: userEventCount,
          }
        : null,
      contextScope: row.userId ? "user" : row.sessionId ? "session" : "none",
    },
  })
}
