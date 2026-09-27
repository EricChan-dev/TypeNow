import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import {
  analyticsEvents,
  courses,
  lessons,
  paymentOrders,
  practiceRecords,
  sentences,
  subscriptions,
  users,
} from "@/lib/db/schema"
import { requireAdmin } from "@/lib/admin-auth"
import { parseRange, rangeStart, rangeLabel } from "@/lib/admin-range"
import { getCachedCount, STATS_KEYS } from "@/lib/stats-cache"
import { and, gte, eq, sql } from "drizzle-orm"

/**
 * 后台仪表盘统计。
 *
 * 两类指标分开对待，这是本接口的核心设计：
 *
 *   activity —— **用户行为**，随 range 变化（近一周/一月/一季/不限）。
 *               新增用户、活跃用户、练习数、埋点数、收入、领取体验会员。
 *               这些都在 created_at / paid_at 上过滤，配套索引见 00014 迁移。
 *
 *   totals   —— **内容与存量**，不随时间筛选（课程/课时/句子/用户总量）。
 *               「句子总数」这种数字放时间筛选里没有意义，而且 sentences 有 46 万行、
 *               没有 created_at 索引，按时间过滤会变成全表扫 3GB。
 *               所以它走 stats-cache（site_config + 10 分钟 TTL），一次主键读返回。
 *
 * 前端必须把这两组分开显示并标注，否则用户会以为「句子总数 46 万」是近一周的。
 */
export async function GET(request: Request) {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth
  if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })
  // 顶层判空后取别名：TS 的收窄不会带进下面 getCachedCount 的 async 闭包
  const database = db

  const { searchParams } = new URL(request.url)
  const range = parseRange(searchParams.get("range"))
  const from = rangeStart(range)
  // drizzle 条件：range=all 时不加时间过滤
  const since = <T extends { createdAt: unknown }>(col: T) =>
    from ? gte(col.createdAt as never, from) : undefined

  const dayExpr = (col: unknown) => sql<string>`DATE(${col})`
  const trendSince = from ?? new Date(Date.now() - 90 * 86400_000)

  const [
    newUsers,
    activeRow,
    practiceRow,
    eventRow,
    paidRow,
    trialClaimRow,
    totalUsers,
    activeSubs,
    dailyUsers,
    dailyPractice,
    dailyEvents,
    dailyPaid,
    totalSentences,
    totalCourses,
    totalLessons,
  ] = await Promise.all([
    // ── activity：随 range 变化 ──
    db
      .select({ n: sql<number>`COUNT(*)` })
      .from(users)
      .where(since(users))
      .then((r) => Number(r[0]?.n ?? 0)),

    db
      .select({
        n: sql<number>`COUNT(DISTINCT ${practiceRecords.userId})`,
      })
      .from(practiceRecords)
      .where(since(practiceRecords))
      .then((r) => Number(r[0]?.n ?? 0)),

    db
      .select({ n: sql<number>`COUNT(*)` })
      .from(practiceRecords)
      .where(since(practiceRecords))
      .then((r) => Number(r[0]?.n ?? 0)),

    db
      .select({ n: sql<number>`COUNT(*)` })
      .from(analyticsEvents)
      .where(since(analyticsEvents))
      .then((r) => Number(r[0]?.n ?? 0)),

    db
      .select({
        n: sql<number>`COUNT(*)`,
        fen: sql<number>`COALESCE(SUM(${paymentOrders.amount}), 0)`,
      })
      .from(paymentOrders)
      .where(
        from
          ? and(eq(paymentOrders.status, "paid"), gte(paymentOrders.paidAt, from))
          : eq(paymentOrders.status, "paid"),
      )
      .then((r) => ({ n: Number(r[0]?.n ?? 0), fen: Number(r[0]?.fen ?? 0) })),

    db
      .select({ n: sql<number>`COUNT(*)` })
      .from(analyticsEvents)
      .where(
        from
          ? and(eq(analyticsEvents.eventType, "trial_claimed"), gte(analyticsEvents.createdAt, from))
          : eq(analyticsEvents.eventType, "trial_claimed"),
      )
      .then((r) => Number(r[0]?.n ?? 0)),

    // ── totals：不随 range 变化 ──
    db
      .select({ n: sql<number>`COUNT(*)` })
      .from(users)
      .then((r) => Number(r[0]?.n ?? 0)),

    db
      .select({ n: sql<number>`COUNT(*)` })
      .from(subscriptions)
      .where(eq(subscriptions.status, "active"))
      .then((r) => Number(r[0]?.n ?? 0)),

    // ── 每日趋势（供图表）──
    // range=all 时不留空，趋势仍只取最近 90 天：一屏画不下更长的，也没必要。
    // 注意先算出 Date 再传 gte，不要写 `from ?? gte(...)`（那会得到 Date | SQL 联合，类型不通过）。
    db
      .select({ date: dayExpr(users.createdAt), n: sql<number>`COUNT(*)` })
      .from(users)
      .where(gte(users.createdAt, trendSince))
      .groupBy(dayExpr(users.createdAt))
      .then((rows) => rows.map((r) => ({ date: r.date, n: Number(r.n) }))),

    db
      .select({ date: dayExpr(practiceRecords.createdAt), n: sql<number>`COUNT(*)` })
      .from(practiceRecords)
      .where(gte(practiceRecords.createdAt, trendSince))
      .groupBy(dayExpr(practiceRecords.createdAt))
      .then((rows) => rows.map((r) => ({ date: r.date, n: Number(r.n) }))),

    db
      .select({ date: dayExpr(analyticsEvents.createdAt), n: sql<number>`COUNT(*)` })
      .from(analyticsEvents)
      .where(gte(analyticsEvents.createdAt, trendSince))
      .groupBy(dayExpr(analyticsEvents.createdAt))
      .then((rows) => rows.map((r) => ({ date: r.date, n: Number(r.n) }))),

    db
      .select({
        date: dayExpr(paymentOrders.paidAt),
        fen: sql<number>`COALESCE(SUM(${paymentOrders.amount}), 0)`,
      })
      .from(paymentOrders)
      .where(
        from
          ? and(eq(paymentOrders.status, "paid"), gte(paymentOrders.paidAt, from))
          : eq(paymentOrders.status, "paid"),
      )
      .groupBy(dayExpr(paymentOrders.paidAt))
      .then((rows) => rows.map((r) => ({ date: r.date, fen: Number(r.fen) }))),

    // ── 内容总量走缓存（句子表 46 万行，不能每次 COUNT(*)）──
    getCachedCount(STATS_KEYS.totalSentences, async () => {
      const r = await database.select({ n: sql<number>`COUNT(*)` }).from(sentences)
      return Number(r[0]?.n ?? 0)
    }),
    getCachedCount(STATS_KEYS.totalCourses, async () => {
      const r = await database.select({ n: sql<number>`COUNT(*)` }).from(courses)
      return Number(r[0]?.n ?? 0)
    }),
    getCachedCount(STATS_KEYS.totalLessons, async () => {
      const r = await database.select({ n: sql<number>`COUNT(*)` }).from(lessons)
      return Number(r[0]?.n ?? 0)
    }),
  ])

  // 把四组按天数据合并成一张趋势表（日期并集）
  const byDate = new Map<string, { date: string; newUsers: number; practice: number; events: number; revenueFen: number }>()
  const touch = (d: string | null) => {
    if (!d) return null
    if (!byDate.has(d)) byDate.set(d, { date: d, newUsers: 0, practice: 0, events: 0, revenueFen: 0 })
    return byDate.get(d)!
  }
  for (const r of dailyUsers) { const e = touch(r.date); if (e) e.newUsers = r.n }
  for (const r of dailyPractice) { const e = touch(r.date); if (e) e.practice = r.n }
  for (const r of dailyEvents) { const e = touch(r.date); if (e) e.events = r.n }
  for (const r of dailyPaid) { const e = touch(r.date); if (e) e.revenueFen = r.fen }

  return NextResponse.json({
    range,
    rangeLabel: rangeLabel(range),
    from: from ? from.toISOString() : null,
    activity: {
      newUsers,
      activeUsers: activeRow,
      practiceRecords: practiceRow,
      events: eventRow,
      paidOrders: paidRow.n,
      revenueFen: paidRow.fen,
      trialClaims: trialClaimRow,
    },
    totals: {
      users: totalUsers,
      activeSubscriptions: activeSubs,
      // null 表示缓存读取失败（不阻塞页面，前端显示「—」）
      sentences: totalSentences,
      courses: totalCourses,
      lessons: totalLessons,
    },
    daily: Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date)),
  })
}
