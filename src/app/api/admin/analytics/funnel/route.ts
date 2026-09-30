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
import { DEFAULT_RANGE, parseRangeQuery, resolveRange } from "@/lib/admin-range"
import { signupChannelLabel } from "@/lib/signup-source"
import { eq, and, gte, lte, inArray, sql, type SQL } from "drizzle-orm"

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
  // 闭包（下面的 breakdownBy）里会丢失 db 的非空收窄，所以先落到一个局部常量。
  const database = db

  const { searchParams } = new URL(request.url)
  // 这里 always 有一个窗口（缺参数就按默认），与列表接口"不给就不过滤"不同
  const range = resolveRange(
    parseRangeQuery(searchParams) ?? { range: DEFAULT_RANGE, from: null, to: null },
  )
  const from = range.start
  const to = range.end

  // cohort：该时间段注册的用户 id 子查询；range=all 时即全体。
  // 自定义区间的上界也要带上，否则"9/1~9/10"会把 9/11 之后注册的人也算进来
  const cohortIds = (from || to
    ? db
        .select({ id: users.id })
        .from(users)
        .where(
          and(
            from ? gte(users.createdAt, from) : undefined,
            to ? lte(users.createdAt, to) : undefined,
          ),
        )
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
      .where(
        from || to
          ? and(
              from ? gte(users.createdAt, from) : undefined,
              to ? lte(users.createdAt, to) : undefined,
            )
          : undefined,
      )
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

  // ── 按来源拆解（推广期新增）────────────────────────────────────────────────
  //
  // 上面那个漏斗只有一个总数，回答的是"整体转化如何"。但推广期真正要回答的是
  // **"哪条渠道值得继续投"**：小红书那条笔记带来的人、抖音直播带来的人、
  // 某个推广员带来的人，各自的转化率差多少。没有这个拆解，"沉淀推广经验"就
  // 只是一句感觉，交不出数字。
  //
  // 三个维度：
  //   · 注册渠道（users.signup_channel）—— 用户从哪个入口建的号
  //   · 推荐关系（users.referred_by 是否为空）—— 推广体系到底有没有在起作用
  //   · UTM 来源（signup_source.utm.utm_source）—— 具体是哪条内容/哪次投放
  //
  // ⚠️ 口径必须与上面的 cohort 总数**完全一致**。这里刻意复用同一个 cohortIds
  // 子查询，而不是另写一遍时间范围过滤 —— 两处各写一份，迟早会漂移，
  // 而报表里"分渠道加起来不等于总数"会让人先怀疑数据错了，而不是怀疑口径。
  // 返回体里的 `breakdownConsistency` 把这个校验显式暴露出来。
  const breakdownBy = async (expr: SQL<string | null>) => {
    const rows = await database
      .select({
        key: expr,
        registered: sql<number>`COUNT(DISTINCT ${users.id})`,
        practiced: sql<number>`COUNT(DISTINCT ${practiceRecords.userId})`,
        paid: sql<number>`COUNT(DISTINCT ${paymentOrders.userId})`,
      })
      .from(users)
      // 两个 LEFT JOIN 会让行数相乘，所以每个指标都必须 COUNT(DISTINCT ...)；
      // 用 COUNT(*) 会把"练过很多句"的人重复计数。
      .leftJoin(practiceRecords, eq(practiceRecords.userId, users.id))
      .leftJoin(
        paymentOrders,
        and(eq(paymentOrders.userId, users.id), eq(paymentOrders.status, "paid")),
      )
      .where(inArray(users.id, cohortIds))
      .groupBy(expr)

    return rows.map((r) => {
      const registered = Number(r.registered ?? 0)
      const practiced = Number(r.practiced ?? 0)
      const paid = Number(r.paid ?? 0)
      return {
        key: r.key ?? "—",
        registered,
        practiced,
        paid,
        practiceRate: registered > 0 ? practiced / registered : null,
        payRate: registered > 0 ? paid / registered : null,
      }
    })
  }

  const [channelRows, referralRows, utmRows] = await Promise.all([
    breakdownBy(sql<string | null>`COALESCE(${users.signupChannel}, '(未知)')`),
    breakdownBy(
      sql<string | null>`CASE WHEN ${users.referredBy} IS NULL THEN 'organic' ELSE 'referred' END`,
    ),
    breakdownBy(
      sql<string | null>`COALESCE(JSON_UNQUOTE(JSON_EXTRACT(${users.signupSource}, '$.utm.utm_source')), '(无来源参数)')`,
    ),
  ])

  const sortByRegistered = <T extends { registered: number }>(rows: T[]) =>
    [...rows].sort((a, b) => b.registered - a.registered)

  const bySignupChannel = sortByRegistered(channelRows).map((r) => ({
    ...r,
    // 认不出的值原样返回（signupChannelLabel 的行为），不要吞掉历史数据
    label: r.key === "(未知)" ? "未知" : signupChannelLabel(r.key),
  }))

  const REFERRAL_LABELS: Record<string, string> = {
    organic: "自然注册（无推荐人）",
    referred: "推广链接带来",
  }
  const byReferral = sortByRegistered(referralRows).map((r) => ({
    ...r,
    label: REFERRAL_LABELS[r.key] ?? r.key,
  }))

  const byUtmSource = sortByRegistered(utmRows).map((r) => ({
    ...r,
    label: r.key === "(无来源参数)" ? "无来源参数" : r.key,
  }))

  // 分渠道注册数之和应当等于 cohort 总数。不等于就说明口径漂移了，
  // 如实暴露而不是藏起来（同 visitorShortfall 的处理方式）。
  const registeredSum =
    bySignupChannel.reduce((s, r) => s + r.registered, 0)

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
    rangeLabel: range.label,
    cohortSize,
    // 第一步「访问站点」是全站流量口径，与后面的同期群不是同一个集合，
    // 这件事必须在界面上写清楚，否则"访客 100 → 注册 3"会被当成"转化率 3%"
    // 去和"注册 3 → 付费 0"对比，而两者分母根本不是一回事。
    cohortNote:
      range.range === "all"
        ? `第一步「访问站点」是全部 ${visitors} 位独立访客（含已注册用户，按 visitor 去重）；` +
          `其后各步改成同期群口径 —— 只统计全部 ${cohortSize} 位用户中做过各步骤的人数。` +
          `两段分母不同（访客 vs 用户），不要跨段比较比率。`
        : `第一步「访问站点」是${range.label}首次出现的 ${visitors} 位独立访客（含后来注册的那批人，` +
          `按 visitor 去重，见 lib/visitor.ts）；其后各步改成同期群口径 —— 只统计「${range.label}注册的 ` +
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
    // 按来源拆解：推广期"哪条渠道值得继续投"的答案在这里。
    // 三个维度共用同一个 cohort，所以各自的和都应当等于 cohortSize。
    breakdown: {
      bySignupChannel,
      byReferral,
      byUtmSource,
      consistency: {
        registeredSum,
        cohortSize,
        consistent: registeredSum === cohortSize,
      },
    },
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
