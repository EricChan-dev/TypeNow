import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { analyticsEvents } from "@/lib/db/schema"
import { requireAdmin } from "@/lib/admin-auth"
import { buildEventWhere, parseEventFilter } from "@/lib/admin-event-filter"
import { rangeLabel } from "@/lib/admin-range"
import { desc, sql } from "drizzle-orm"

/** 图表里最多画几条事件曲线。再多图例就糊成一团，也看不出趋势。 */
const TOP_EVENT_SERIES = 6

/**
 * 埋点分析的图表与汇总数据。
 *
 * 与 /api/admin/events（明细表）共用同一份筛选条件，保证「图上看到的」和
 * 「表里翻到的」是同一批数据。参数完全一致，可以放心把 URL 原样传过来。
 *
 * 返回三块：
 *   summary —— 总量、独立访客、独立用户、匿名占比、时间跨度。用于判断"这段数据够不够看"。
 *              独立访客（visitors）≠ 独立用户（users）：前者含未登录的人，
 *              是"有多少人来过"，后者只数已登录的账号。
 *   trend   —— 按天 × 事件的堆叠序列。看"哪类行为在涨/在跌"。
 *   byEvent —— 事件排行（次数 + 独立人数）。次数高但人数低 = 少数人刷量。
 *   pages   —— 页面排行。看流量落在哪些页面。
 *   hourly  —— 24 小时分布。判断用户什么时候来，指导推送/发版时机。
 */
export async function GET(request: Request) {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth
  if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })
  // 存进局部常量：下面的趋势序列在 .map() 回调里取数据，
  // 而 TS 的类型收窄不会穿过回调边界（回调可能在 null 检查之前就被调用），
  // 直接用外层 db 会报 "possibly null"
  const database = db

  const { searchParams } = new URL(request.url)
  const filter = parseEventFilter(searchParams)
  const where = buildEventWhere(filter)

  const [summaryRow, eventRows, pageRows, hourlyRows] = await Promise.all([
    db
      .select({
        events: sql<number>`COUNT(*)`,
        users: sql<number>`COUNT(DISTINCT ${analyticsEvents.userId})`,
        anonymous: sql<number>`SUM(CASE WHEN ${analyticsEvents.userId} IS NULL THEN 1 ELSE 0 END)`,
        sessions: sql<number>`COUNT(DISTINCT ${analyticsEvents.sessionId})`,
        // 独立访客：优先用长期 visitor_id，缺失（存量数据 / cookie 被拦）时退回
        // session_id。退回口径会偏大（同一人多次访问算多个），所以界面上
        // 这个数只当"不小于真实访客数"的下界看。空串要当 NULL，否则
        // 所有"两列皆空"的行会被并成一个神秘访客。
        visitors: sql<number>`COUNT(DISTINCT COALESCE(NULLIF(${analyticsEvents.visitorId}, ''), NULLIF(${analyticsEvents.sessionId}, '')))`,
        first: sql<string | null>`MIN(${analyticsEvents.createdAt})`,
        last: sql<string | null>`MAX(${analyticsEvents.createdAt})`,
      })
      .from(analyticsEvents)
      .where(where),

    db
      .select({
        eventType: analyticsEvents.eventType,
        events: sql<number>`COUNT(*)`,
        users: sql<number>`COUNT(DISTINCT ${analyticsEvents.userId})`,
        lastAt: sql<string | null>`MAX(${analyticsEvents.createdAt})`,
      })
      .from(analyticsEvents)
      .where(where)
      .groupBy(analyticsEvents.eventType)
      .orderBy(desc(sql`COUNT(*)`)),

    db
      .select({
        page: sql<string>`COALESCE(NULLIF(${analyticsEvents.pageUrl}, ''), '(未知)')`,
        count: sql<number>`COUNT(*)`,
        users: sql<number>`COUNT(DISTINCT ${analyticsEvents.userId})`,
      })
      .from(analyticsEvents)
      .where(where)
      .groupBy(sql`COALESCE(NULLIF(${analyticsEvents.pageUrl}, ''), '(未知)')`)
      .orderBy(desc(sql`COUNT(*)`))
      .limit(12),

    db
      .select({
        hour: sql<number>`HOUR(${analyticsEvents.createdAt})`,
        count: sql<number>`COUNT(*)`,
      })
      .from(analyticsEvents)
      .where(where)
      .groupBy(sql`HOUR(${analyticsEvents.createdAt})`)
      .orderBy(sql`HOUR(${analyticsEvents.createdAt})`),
  ])

  const topEvents = eventRows.slice(0, TOP_EVENT_SERIES).map((r) => r.eventType)

  /**
   * 趋势序列。
   *
   * 做法：把 TOP_EVENT_SERIES 个事件各自按天 COUNT 出来（每个事件一条 GROUP BY 查询），
   * 再在 JS 里合成「日期 → 各事件次数」的宽表。
   *
   * 为什么不写一条 `GROUP BY date, event_type`：那条查询会把**所有**事件的
   * 日期组合都返回（13 个事件 × 90 天 ≈ 上千行），而图表只要前 6 个事件的曲线，
   * 剩下的全部白算。多跑 6 条走索引的小查询反而更快，也更好读。
   *
   * 时间粒度：range=all 时按月聚合。按天画几百个点在图上是糊掉的毛刺，
   * 看不出趋势，还拖慢渲染。其余档位最多 90 天，按天正合适。
   */
  const byMonth = filter.range === "all"
  const dateExpr = byMonth
    ? sql<string>`DATE_FORMAT(${analyticsEvents.createdAt}, '%Y-%m')`
    : sql<string>`DATE(${analyticsEvents.createdAt})`

  const trendRows = await Promise.all(
    topEvents.map((eventType) =>
      database
        .select({ bucket: dateExpr, count: sql<number>`COUNT(*)` })
        .from(analyticsEvents)
        .where(where ? sql`${where} AND ${analyticsEvents.eventType} = ${eventType}` : sql`${analyticsEvents.eventType} = ${eventType}`)
        .groupBy(dateExpr)
        .orderBy(dateExpr),
    ),
  )

  // 把「每个事件各自的日期列表」并成同一组横轴刻度
  const buckets = Array.from(new Set(trendRows.flat().map((r) => r.bucket))).sort()
  const trend = buckets.map((bucket) => {
    const row: Record<string, string | number> = { bucket }
    topEvents.forEach((eventType, i) => {
      row[eventType] = Number(trendRows[i].find((r) => r.bucket === bucket)?.count ?? 0)
    })
    return row
  })

  const summary = summaryRow[0]
  const totalEvents = Number(summary?.events ?? 0)
  const anonymous = Number(summary?.anonymous ?? 0)

  return NextResponse.json({
    range: filter.range,
    rangeLabel: rangeLabel(filter.range),
    granularity: byMonth ? "month" : "day",
    summary: {
      events: totalEvents,
      users: Number(summary?.users ?? 0),
      sessions: Number(summary?.sessions ?? 0),
      visitors: Number(summary?.visitors ?? 0),
      anonymous,
      // 未登录占比：这个数很高说明绝大部分流量没转化到账号，
      // 是获客环节的问题而不是产品功能的问题
      anonymousRate: totalEvents > 0 ? anonymous / totalEvents : null,
      firstAt: summary?.first ?? null,
      lastAt: summary?.last ?? null,
    },
    series: topEvents,
    trend,
    byEvent: eventRows.map((r) => ({
      eventType: r.eventType,
      events: Number(r.events),
      users: Number(r.users),
      lastAt: r.lastAt,
    })),
    pages: pageRows.map((r) => ({ page: r.page, count: Number(r.count), users: Number(r.users) })),
    hourly: hourlyRows.map((r) => ({ hour: Number(r.hour), count: Number(r.count) })),
  })
}
