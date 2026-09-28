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
import { activeSubscriptionSql } from "@/lib/subscription"
import { FUNNEL_STEPS } from "@/lib/analytics-events"
import { parseRange, rangeStart, rangeLabel } from "@/lib/admin-range"
import { eq, gte, inArray, sql } from "drizzle-orm"

/**
 * 首启漏斗报表（**同期群口径**，第一步例外）。
 *
 * 关键语义：选定时间范围后，先圈出「该时间段注册的用户」作为一个 cohort，
 * 再看这个 cohort 里有多少人做过后续每一步。**不是**「各步骤各自按时间过滤」——
 * 后者会把 3 个月前注册、本周才练完一句的人算进"本周注册 → 练完一句"，
 * 于是漏斗会出现下游大于上游的荒谬结果。
 *
 * 代价是"未成熟 cohort"：刚注册两天的人还没来得及付费，付费步骤天然偏低。
 * 这是同期群漏斗的正常性质，所以接口返回 cohortNote 让界面写清楚，否则会被当成 bug。
 *
 * **例外是第一步「访问站点」**（2026-09-28 补）：获客顶端必须先有流量才有 cohort，
 * 而 cohort 的定义本身就排除了没注册的人 —— 只用同期群口径，这个问题
 * （"来了 100 人只注册了 3 人"）在系统里永远没有答案。所以第一步是全站流量口径
 * （范围内首访的独立访客），并额外返回 acquisition 块。两段分母不同，
 * cohortNote 与界面都必须写明，否则会有人拿跨段的比率做对比。
 *
 * 口径是混合的（见 lib/analytics-events 的 FUNNEL_STEPS.source）：
 *   访问站点 —— 全站流量（按 visitor 去重，见 lib/visitor.ts）
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

  /**
   * 访客身份表达式。visitor_id 是 2026-09-28 才加的列（见 db/migrations/00024），
   * 存量数据与"cookie 被拦/隐私模式"的场景下它是 NULL，此时退回 session_id：
   * 数字会偏大（同一人多次访问被算成多个访客），但不会丢事件。
   * session_id 同样是 NULL 或空串时整个表达式为 NULL，外层要显式排除，
   * 否则 GROUP BY 会把它们并成一个"神秘访客"。
   */
  const visitorKey = sql`COALESCE(NULLIF(${analyticsEvents.visitorId}, ''), NULLIF(${analyticsEvents.sessionId}, ''))`

  // 每个访客一行：首次出现时间 + 是否已经归属到某个账号。
  // 为什么必须先算「首次出现时间」再筛范围：这样得到的才是**新访客**。
  // 直接用 created_at >= from 会把"老用户这周又来逛了一次"算成新访客，
  // 于是访客数被日常活跃撑大，注册转化率随之被严重低估。
  const visitorAgg = db
    .select({
      vk: sql<string | null>`${visitorKey}`.as("vk"),
      firstAt: sql<string>`MIN(${analyticsEvents.createdAt})`.as("first_at"),
      // 0/1：这个访客的任何一条事件是否带 user_id。带过就说明他后来注册/登录了，
      // 也就是「匿名 → 注册」这条链路被接上了（注册事件本身会带 visitor_id，
      // 登录之后的上报事件同时带 userId 与 visitorId，两者都算）
      hasUser: sql<number>`MAX(${analyticsEvents.userId} IS NOT NULL)`.as("has_user"),
    })
    .from(analyticsEvents)
    .groupBy(visitorKey)
    .as("visitor_agg")

  const [
    cohortSize,
    practicedUsers,
    paidUsers,
    ordersRow,
    subsRow,
    eventRows,
    dailyRows,
    pageRows,
    visitorRow,
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

    // 与仪表盘「活跃订阅」同口径：到期未回收的行不算生效（见 lib/subscription）
    db
      .select({ n: sql<number>`COUNT(*)` })
      .from(subscriptions)
      .where(activeSubscriptionSql())
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

    // 获客段：新访客数与其中已归属账号的人数（口径见下方 acquisition 注释）。
    // 外层必须排掉 vk IS NULL 的那一组：visitor_id 与 session_id 同时缺失时
    // COALESCE 得到 NULL，GROUP BY 会把它们聚成一行"神秘访客"，
    // 平白多算一个人，而这一行还可能满足 first_at >= from。
    db
      .select({
        visitors: sql<number>`COUNT(*)`,
        converted: sql<number>`COALESCE(SUM(${visitorAgg.hasUser}), 0)`,
      })
      .from(visitorAgg)
      .where(
        from
          ? sql`${visitorAgg.vk} IS NOT NULL AND ${visitorAgg.firstAt} >= ${from}`
          : sql`${visitorAgg.vk} IS NOT NULL`,
      )
      .then((r) => ({ visitors: Number(r[0]?.visitors ?? 0), converted: Number(r[0]?.converted ?? 0) })),
  ])

  const byEvent = new Map(eventRows.map((r) => [r.eventType, r]))

  const dbValues: Record<string, number> = {
    registered: cohortSize,
    practiced: practicedUsers,
    paid: paidUsers,
  }

  // ── 获客（流量 → 注册）────────────────────────────────────────────────────
  //
  // 上面整段都是**同期群**口径：先圈出这段时间注册的人，再看他们做了哪些事。
  // 这个口径天生答不了"来了 100 人只注册了 3 人"——因为它的第一行就是"注册"，
  // 匿名流量被整体排除在外。这一段补的就是那个缺失的漏斗顶端。
  //
  // 口径说明（必须写清楚，否则两套数字放在一页上必然被误读）：
  //   visitors  —— 这段时间**首次出现**的独立访客（含后来注册的那批人）
  //   converted —— 这批访客里已经归属到某个账号的人数
  //   两者出自同一个访客集合，所以 converted ≤ visitors 恒成立，转化率有意义。
  const rawVisitors = Number(visitorRow?.visitors ?? 0)
  const rawConverted = Number(visitorRow?.converted ?? 0)

  /**
   * 访客数下界修正。
   *
   * 注册人数是数据库权威值，而访客数依赖客户端上报 —— 当某些注册用户的
   * 匿名访问完全没被记录（cookie 被拦、首访早于所选范围）时，会出现
   * **下游大于上游**的荒谬结果（funnel 的走势图会直接画超出 100%）。
   * 这种情况下按注册数取下界，并把转化率置空 —— 宁可不给这个数，
   * 也不要给一个分母明显偏小的比率。同时把 visitorShortfall 暴露给界面写清楚。
   */
  const visitorShortfall = rawVisitors < cohortSize
  const visitors = visitorShortfall ? cohortSize : rawVisitors
  const converted = visitorShortfall ? Math.max(rawConverted, cohortSize) : rawConverted
  const conversionRate =
    !visitorShortfall && visitors > 0 ? converted / visitors : null

  const funnel = FUNNEL_STEPS.map((step) => {
    if (step.source === "db") return { ...step, value: dbValues[step.key] ?? 0 }
    // 推导量（不对应任何单个事件）单独取值，不能走下面的 byEvent 查表
    if (step.source === "traffic") {
      return { ...step, value: step.key === "visited" ? visitors : 0 }
    }
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
    // 第一步「访问站点」是全站流量口径，与后面的同期群不是同一个集合，
    // 这件事必须在界面上写清楚，否则"访客 100 → 注册 3"会被当成"转化率 3%"
    // 去和"注册 3 → 付费 0"对比，而两者分母根本不是一回事。
    cohortNote:
      range === "all"
        ? `第一步「访问站点」是全部 ${visitors} 位独立访客（含已注册用户，按 visitor 去重）；` +
          `其后各步改成同期群口径 —— 只统计全部 ${cohortSize} 位用户中做过各步骤的人数。` +
          `两段分母不同（访客 vs 用户），不要跨段比较比率。`
        : `第一步「访问站点」是${rangeLabel(range)}首次出现的 ${visitors} 位独立访客（含后来注册的那批人，` +
          `按 visitor 去重，见 lib/visitor.ts）；其后各步改成同期群口径 —— 只统计「${rangeLabel(range)}注册的 ` +
          `${cohortSize} 位用户」中做过各步骤的人数。两段分母不同（访客 vs 用户），不要跨段比较比率。` +
          `刚注册的用户还没来得及付费，付费步骤天然偏低，属正常现象。`,
    acquisition: {
      visitors,
      converted,
      conversionRate,
      // 访客数被迫按注册数取下界时为 true（见路由中段注释）。
      // 界面据此提示"部分注册用户的匿名访问未被记录"，而不是把这个差异藏起来。
      visitorShortfall,
      note: visitorShortfall
        ? `有 ${cohortSize - rawVisitors} 位注册用户的匿名访问没有被记录（cookie 被拦截，或首次访问早于所选范围），` +
          `访客数已按注册数取下界，转化率暂不计算。`
        : `访客按一年期 typ_vid cookie 去重（见 lib/visitor.ts）。` +
          `历史数据没有这个字段，只能退回按会话计，因此访客数会偏大、转化率偏低。` +
          `converted 的判据是"这个访客的事件里出现过 user_id"，注册与登录后的上报都会满足。`,
    },
    funnel,
    domain: {
      registered: cohortSize,
      practicedUsers,
      practiceRecords: 0, // 见下方 totals 说明：练习总数不按 cohort，避免误读
      paidUsers,
      paidOrders: ordersRow.n,
      revenueFen: ordersRow.fen,
      subscriptions: subsRow,
      visitors,
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
