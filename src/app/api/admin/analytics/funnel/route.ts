import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import {
  analyticsEvents,
  paymentOrders,
  practiceRecords,
  subscriptions,
  users,
} from "@/lib/db/schema"
import { requireAdmin } from "@/lib/admin-auth"
import { FUNNEL_STEPS } from "@/lib/analytics-events"
import { sql } from "drizzle-orm"

/**
 * 首启漏斗报表。
 *
 * 口径刻意是**混合**的（见 lib/analytics-events 的 FUNNEL_STEPS.source）：
 *
 *   - 注册 / 练完至少一句 / 付费 走**数据库权威数据**。埋点会被广告拦截器挡掉、
 *     会被漏发、会因 JS 报错而少报；这三个最关键的数不能建立在客户端上报之上。
 *   - 打开课程 / 进入练习 / 领取体验 / 看过定价 走**行为埋点**。这些「客户端才知道、
 *     数据库里没有」的动作只能靠埋点。
 *
 * 副作用是它自带一个诊断能力：若某步的埋点数**大于**上一步的 db 数（比如
 * 「打开课程」的人数超过注册人数），说明埋点有重复上报或脏数据，一眼能看出来。
 */
export async function GET() {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth
  if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })

  const [domainRows, eventRows, dailyRows, pageRows] = await Promise.all([
    // ── 权威域数据（不依赖客户端上报） ──
    db
      .select({
        registered: sql<number>`(SELECT COUNT(*) FROM ${users})`,
        practicedUsers: sql<number>`(SELECT COUNT(DISTINCT ${practiceRecords.userId}) FROM ${practiceRecords})`,
        practiceRecords: sql<number>`(SELECT COUNT(*) FROM ${practiceRecords})`,
        paidUsers: sql<number>`(SELECT COUNT(DISTINCT ${paymentOrders.userId}) FROM ${paymentOrders} WHERE ${paymentOrders.status} = 'paid')`,
        paidOrders: sql<number>`(SELECT COUNT(*) FROM ${paymentOrders} WHERE ${paymentOrders.status} = 'paid')`,
        revenueFen: sql<number>`(SELECT COALESCE(SUM(${paymentOrders.amount}), 0) FROM ${paymentOrders} WHERE ${paymentOrders.status} = 'paid')`,
        subscriptions: sql<number>`(SELECT COUNT(*) FROM ${subscriptions} WHERE ${subscriptions.status} = 'active')`,
      })
      .from(sql`(SELECT 1) AS _t`),

    // ── 行为埋点：一次 GROUP BY 拿到所有事件类型的「事件数 / 去重人数」 ──
    db
      .select({
        eventType: analyticsEvents.eventType,
        events: sql<number>`COUNT(*)`,
        // user_id 可空（匿名 page_view），COUNT(DISTINCT) 会自动忽略 NULL，
        // 正是「有多少登录用户做过这件事」的口径
        users: sql<number>`COUNT(DISTINCT ${analyticsEvents.userId})`,
      })
      .from(analyticsEvents)
      .groupBy(analyticsEvents.eventType),

    // ── 近 14 天趋势 ──
    db
      .select({
        date: sql<string>`DATE(${analyticsEvents.createdAt})`,
        events: sql<number>`COUNT(*)`,
        users: sql<number>`COUNT(DISTINCT ${analyticsEvents.userId})`,
      })
      .from(analyticsEvents)
      .where(sql`${analyticsEvents.createdAt} >= DATE_SUB(CURDATE(), INTERVAL 14 DAY)`)
      .groupBy(sql`DATE(${analyticsEvents.createdAt})`)
      .orderBy(sql`DATE(${analyticsEvents.createdAt})`),

    // ── 热门页面 ──
    //
    // 注意取的是 `page_url`，不是 properties.page。原先那版后台报表读的是
    // properties.page，而前端 helper 从来不写这个字段（页面路径一直是放在
    // pageUrl 里传的），所以即使有 page_view 也永远是空表 —— 两处都错，叠在一起。
    db
      .select({
        page: sql<string>`COALESCE(NULLIF(${analyticsEvents.pageUrl}, ''), '(未知)')`,
        count: sql<number>`COUNT(*)`,
      })
      .from(analyticsEvents)
      .where(sql`${analyticsEvents.eventType} = 'page_view'`)
      .groupBy(sql`COALESCE(NULLIF(${analyticsEvents.pageUrl}, ''), '(未知)')`)
      .orderBy(sql`COUNT(*) DESC`)
      .limit(10),
  ])

  const domain = domainRows[0]
  const byEvent = new Map(eventRows.map((r) => [r.eventType, r]))

  // 漏斗每一步的取值：db 步骤取域数据，events 步骤取该事件的去重人数
  const values: Record<string, number> = {
    registered: Number(domain?.registered ?? 0),
    practiced: Number(domain?.practicedUsers ?? 0),
    paid: Number(domain?.paidUsers ?? 0),
  }

  const funnel = FUNNEL_STEPS.map((step) => {
    if (step.source === "db") {
      return { ...step, value: values[step.key] ?? 0 }
    }
    const row = byEvent.get(step.key)
    // 埋点里可能混入匿名（user_id 为 NULL）的记录，去重人数只算登录用户；
    // 若该事件全是匿名，users 会是 0，此时退回事件总数以免报表显示成 0 而误导。
    const distinctUsers = Number(row?.users ?? 0)
    const total = Number(row?.events ?? 0)
    return { ...step, value: distinctUsers > 0 ? distinctUsers : total }
  }).map((step, i, arr) => {
    const top = arr[0]?.value ?? 0
    const prev = i > 0 ? arr[i - 1].value : step.value
    return {
      ...step,
      // 相对上一步的转化率：这是漏斗真正要看的东西
      stepRate: prev > 0 ? step.value / prev : null,
      // 相对第一步的整体转化率
      overallRate: top > 0 ? step.value / top : null,
    }
  })

  return NextResponse.json({
    funnel,
    domain: {
      registered: Number(domain?.registered ?? 0),
      practicedUsers: Number(domain?.practicedUsers ?? 0),
      practiceRecords: Number(domain?.practiceRecords ?? 0),
      paidUsers: Number(domain?.paidUsers ?? 0),
      paidOrders: Number(domain?.paidOrders ?? 0),
      revenueFen: Number(domain?.revenueFen ?? 0),
      subscriptions: Number(domain?.subscriptions ?? 0),
    },
    events: eventRows
      .map((r) => ({ eventType: r.eventType, events: Number(r.events), users: Number(r.users) }))
      .sort((a, b) => b.events - a.events),
    daily: dailyRows.map((r) => ({
      date: r.date,
      events: Number(r.events),
      users: Number(r.users),
    })),
    topPages: pageRows.map((r) => ({ page: r.page, count: Number(r.count) })),
  })
}
