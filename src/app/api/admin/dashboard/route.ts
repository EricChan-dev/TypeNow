import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { aliveCourse, aliveLesson, aliveSentence } from "@/lib/soft-delete"
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
import { DEFAULT_RANGE, parseRangeQuery, resolveRange } from "@/lib/admin-range"
import { getCachedCount, STATS_KEYS } from "@/lib/stats-cache"
import { userFeedback } from "@/lib/db/schema"
import { OPEN_FEEDBACK_STATUSES } from "@/lib/feedback"
import { and, gte, lte, eq, inArray, sql } from "drizzle-orm"
// 会员/订阅的"此刻是否生效"只有一份口径，见 lib/subscription
import { activeSubscriptionSql } from "@/lib/subscription"

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
  // 这里 always 有一个窗口（缺参数就按默认），与列表接口"不给就不过滤"不同
  const range = resolveRange(
    parseRangeQuery(searchParams) ?? { range: DEFAULT_RANGE, from: null, to: null },
  )
  const from = range.start
  const to = range.end
  // drizzle 条件：range=all 时不加时间过滤。
  // 上界只在自定义区间（与「今天」）下存在 —— 预设窗口都是"到现在"。
  const since = <T extends { createdAt: unknown }>(col: T) =>
    from || to
      ? and(
          from ? gte(col.createdAt as never, from) : undefined,
          to ? lte(col.createdAt as never, to) : undefined,
        )
      : undefined

  const dayExpr = (col: unknown) => sql<string>`DATE(${col})`
  const trendSince = from ?? new Date(Date.now() - 90 * 86400_000)

  const [
    newUsers,
    activeRow,
    practiceRow,
    eventRow,
    visitorRow,
    paidRow,
    trialClaimRow,
    totalUsers,
    activeSubs,
    dailyUsers,
    dailyPractice,
    dailyEvents,
    dailyPaid,
    // 位置必须与下面 Promise.all 的顺序**逐一对齐**：这个数组是位置解构，
    // 中间多插一个查询而变量名写在末尾，会让后面所有的值整体错位一格
    // （实测：pendingFeedback 拿到的是课时总数，totals.sentences 拿到的是反馈数）
    pendingFeedback,
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

    // 独立访客 + 未登录占比（随 range 变化）。
    // 这一条回答的是「来了多少人、其中多少没注册」—— 与「新增用户」并排放在
    // 仪表盘上，注册转化率一眼可见。此前仪表盘只有事件总数，看不出人数。
    //
    // 访客身份优先用 visitor_id，缺失（存量数据 / cookie 被拦）时退回 session_id：
    // 退回口径会偏大（同一人多次访问算多个），所以这个数只能当下界看。
    // 两列都空的行必须排除，否则会被聚成一个"神秘访客"（见 funnel 路由同类注释）。
    db
      .select({
        visitors: sql<number>`COUNT(DISTINCT COALESCE(NULLIF(${analyticsEvents.visitorId}, ''), NULLIF(${analyticsEvents.sessionId}, '')))`,
        anonymous: sql<number>`SUM(CASE WHEN ${analyticsEvents.userId} IS NULL THEN 1 ELSE 0 END)`,
        events: sql<number>`COUNT(*)`,
      })
      .from(analyticsEvents)
      .where(since(analyticsEvents))
      .then((r) => ({
        visitors: Number(r[0]?.visitors ?? 0),
        anonymous: Number(r[0]?.anonymous ?? 0),
        events: Number(r[0]?.events ?? 0),
      })),

    db
      .select({
        n: sql<number>`COUNT(*)`,
        fen: sql<number>`COALESCE(SUM(${paymentOrders.amount}), 0)`,
      })
      .from(paymentOrders)
      .where(
        from || to
          ? and(
              eq(paymentOrders.status, "paid"),
              from ? gte(paymentOrders.paidAt, from) : undefined,
              to ? lte(paymentOrders.paidAt, to) : undefined,
            )
          : eq(paymentOrders.status, "paid"),
      )
      .then((r) => ({ n: Number(r[0]?.n ?? 0), fen: Number(r[0]?.fen ?? 0) })),

    db
      .select({ n: sql<number>`COUNT(*)` })
      .from(analyticsEvents)
      .where(
        from || to
          ? and(
              eq(analyticsEvents.eventType, "trial_claimed"),
              from ? gte(analyticsEvents.createdAt, from) : undefined,
              to ? lte(analyticsEvents.createdAt, to) : undefined,
            )
          : eq(analyticsEvents.eventType, "trial_claimed"),
      )
      .then((r) => Number(r[0]?.n ?? 0)),

    // ── totals：不随 range 变化 ──
    db
      .select({ n: sql<number>`COUNT(*)` })
      .from(users)
      .then((r) => Number(r[0]?.n ?? 0)),

    // 「活跃订阅」= 此刻仍然生效，而不是"状态字段写着 active"。
    // 到期未清理的行会一直留在 active 上（见 lib/subscription 的说明），
    // 而这张卡片的文案是「生效中的订阅」——那里写着什么就得算什么。
    db
      .select({ n: sql<number>`COUNT(*)` })
      .from(subscriptions)
      .where(activeSubscriptionSql())
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
        from || to
          ? and(
              eq(paymentOrders.status, "paid"),
              from ? gte(paymentOrders.paidAt, from) : undefined,
              to ? lte(paymentOrders.paidAt, to) : undefined,
            )
          : eq(paymentOrders.status, "paid"),
      )
      .groupBy(dayExpr(paymentOrders.paidAt))
      .then((rows) => rows.map((r) => ({ date: r.date, fen: Number(r.fen) }))),

    // ── 内容总量走缓存（句子表 46 万行，不能每次 COUNT(*)）──
    // 「待处理反馈」是**待办**，不随时间范围变化（与内容总量同类）。
    // 口径必须与反馈页的「未结束」一致：待处理 + 处理中，
    // 否则仪表盘上的数字和点进去的列表条数对不上。
    database
      .select({ n: sql<number>`COUNT(*)` })
      .from(userFeedback)
      .where(inArray(userFeedback.status, OPEN_FEEDBACK_STATUSES))
      .then((r) => Number(r[0]?.n ?? 0)),

    getCachedCount(STATS_KEYS.totalSentences, async () => {
      const r = await database.select({ n: sql<number>`COUNT(*)` }).from(sentences).where(aliveSentence)
      return Number(r[0]?.n ?? 0)
    }),
    getCachedCount(STATS_KEYS.totalCourses, async () => {
      const r = await database.select({ n: sql<number>`COUNT(*)` }).from(courses).where(aliveCourse)
      return Number(r[0]?.n ?? 0)
    }),
    getCachedCount(STATS_KEYS.totalLessons, async () => {
      const r = await database.select({ n: sql<number>`COUNT(*)` }).from(lessons).where(aliveLesson)
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
    rangeLabel: range.label,
    from: from ? from.toISOString() : null,
    activity: {
      newUsers,
      activeUsers: activeRow,
      practiceRecords: practiceRow,
      events: eventRow,
      // 独立访客（含未登录的人）。与 newUsers 并排看就是注册转化率的分母
      visitors: visitorRow.visitors,
      // 未登录事件占比：这个数很高说明绝大部分流量没转化到账号，
      // 是获客环节的问题而不是产品功能的问题
      anonymousRate: visitorRow.events > 0 ? visitorRow.anonymous / visitorRow.events : null,
      paidOrders: paidRow.n,
      revenueFen: paidRow.fen,
      trialClaims: trialClaimRow,
    },
    pendingFeedback,
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
