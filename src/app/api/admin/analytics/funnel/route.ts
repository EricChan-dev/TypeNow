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
import { parseRange, rangeStart, rangeLabel } from "@/lib/admin-range"
import { eq, gte, inArray, sql } from "drizzle-orm"

/**
 * 首启漏斗报表（**同期群口径**）。
 *
 * 关键语义：选定时间范围后，先圈出「该时间段注册的用户」作为一个 cohort，
 * 再看这个 cohort 里有多少人做过后续每一步。**不是**「各步骤各自按时间过滤」——
 * 后者会把 3 个月前注册、本周才练完一句的人算进"本周注册 → 练完一句"，
 * 于是漏斗会出现下游大于上游的荒谬结果。
 *
 * 代价是"未成熟 cohort"：刚注册两天的人还没来得及付费，付费步骤天然偏低。
 * 这是同期群漏斗的正常性质，所以接口返回 cohortNote 让界面写清楚，否则会被当成 bug。
 *
 * 口径仍是混合的（见 lib/analytics-events 的 FUNNEL_STEPS.source）：
 *   注册 / 练完一句 / 付费 —— 数据库权威数据
 *   打开课程 / 进入练习 / 领取体验 / 看定价 —— 行为埋点
 *
 * 实现上一律走 drizzle 的查询构造器，不用手写 `sql` 拼列引用：
 * 单表查询里 drizzle 会把列名去掉表限定，手写相关子查询会静默算错
 * （用户列表就踩过这个坑，见 src/app/api/admin/users/route.ts 的注释）。
 */
export async function GET(request: Request) {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth
  if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })

  const { searchParams } = new URL(request.url)
  const range = parseRange(searchParams.get("range"))
  const from = rangeStart(range)

  // cohort：该时间段注册的用户 id 子查询；range=all 时即全体
  const cohortIds = (from
    ? db.select({ id: users.id }).from(users).where(gte(users.createdAt, from))
    : db.select({ id: users.id }).from(users))

  const [
    cohortSize,
    practicedUsers,
    paidUsers,
    ordersRow,
    subsRow,
    eventRows,
    dailyRows,
    pageRows,
  ] = await Promise.all([
    db
      .select({ n: sql<number>`COUNT(*)` })
      .from(users)
      .where(from ? gte(users.createdAt, from) : undefined)
      .then((r) => Number(r[0]?.n ?? 0)),

    db
      .select({ n: sql<number>`COUNT(DISTINCT ${practiceRecords.userId})` })
      .from(practiceRecords)
      .where(inArray(practiceRecords.userId, cohortIds))
      .then((r) => Number(r[0]?.n ?? 0)),

    db
      .select({ n: sql<number>`COUNT(DISTINCT ${paymentOrders.userId})` })
      .from(paymentOrders)
      .where(
        sql`${paymentOrders.status} = 'paid' AND ${paymentOrders.userId} IN (${cohortIds})`,
      )
      .then((r) => Number(r[0]?.n ?? 0)),

    // 收入/订单/订阅是**全站**口径，不按 cohort：用于回答"这段时间赚了多少"
    db
      .select({
        n: sql<number>`COUNT(*)`,
        fen: sql<number>`COALESCE(SUM(${paymentOrders.amount}), 0)`,
      })
      .from(paymentOrders)
      .where(
        from
          ? sql`${paymentOrders.status} = 'paid' AND ${paymentOrders.paidAt} >= ${from}`
          : eq(paymentOrders.status, "paid"),
      )
      .then((r) => ({ n: Number(r[0]?.n ?? 0), fen: Number(r[0]?.fen ?? 0) })),

    db
      .select({ n: sql<number>`COUNT(*)` })
      .from(subscriptions)
      .where(eq(subscriptions.status, "active"))
      .then((r) => Number(r[0]?.n ?? 0)),

    // cohort 内的埋点事件（按类型分组）
    db
      .select({
        eventType: analyticsEvents.eventType,
        events: sql<number>`COUNT(*)`,
        users: sql<number>`COUNT(DISTINCT ${analyticsEvents.userId})`,
      })
      .from(analyticsEvents)
      .where(inArray(analyticsEvents.userId, cohortIds))
      .groupBy(analyticsEvents.eventType),

    // 近 14 天趋势（全站，不按 cohort）
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

    db
      .select({
        page: sql<string>`COALESCE(NULLIF(${analyticsEvents.pageUrl}, ''), '(未知)')`,
        count: sql<number>`COUNT(*)`,
      })
      .from(analyticsEvents)
      .where(eq(analyticsEvents.eventType, "page_view"))
      .groupBy(sql`COALESCE(NULLIF(${analyticsEvents.pageUrl}, ''), '(未知)')`)
      .orderBy(sql`COUNT(*) DESC`)
      .limit(10),
  ])

  const byEvent = new Map(eventRows.map((r) => [r.eventType, r]))

  const dbValues: Record<string, number> = {
    registered: cohortSize,
    practiced: practicedUsers,
    paid: paidUsers,
  }

  const funnel = FUNNEL_STEPS.map((step) => {
    if (step.source === "db") return { ...step, value: dbValues[step.key] ?? 0 }
    const row = byEvent.get(step.key)
    const distinctUsers = Number(row?.users ?? 0)
    const total = Number(row?.events ?? 0)
    return { ...step, value: distinctUsers > 0 ? distinctUsers : total }
  }).map((step, i, arr) => {
    const top = arr[0]?.value ?? 0
    const prev = i > 0 ? arr[i - 1].value : step.value
    return {
      ...step,
      stepRate: prev > 0 ? step.value / prev : null,
      overallRate: top > 0 ? step.value / top : null,
    }
  })

  return NextResponse.json({
    range,
    rangeLabel: rangeLabel(range),
    cohortSize,
    cohortNote:
      range === "all"
        ? "全部用户"
        : `同期群口径：统计「${rangeLabel(range)}注册的 ${cohortSize} 位用户」中做过各步骤的人数。` +
          `刚注册的用户还没来得及付费，付费步骤天然偏低，属正常现象。`,
    funnel,
    domain: {
      registered: cohortSize,
      practicedUsers,
      practiceRecords: 0, // 见下方 totals 说明：练习总数不按 cohort，避免误读
      paidUsers,
      paidOrders: ordersRow.n,
      revenueFen: ordersRow.fen,
      subscriptions: subsRow,
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
