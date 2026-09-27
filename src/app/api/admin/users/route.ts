import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { analyticsEvents, paymentOrders, practiceRecords, users } from "@/lib/db/schema"
import { requireAdmin } from "@/lib/admin-auth"
import { parsePagination } from "@/lib/pagination"
import { parseRange, rangeStart, rangeLabel } from "@/lib/admin-range"
// 列表里显示的是**一句人话**（渠道 + 微信 scene + 首触来源）。
// 让后端算而不是前端算：同一个摘要函数将来详情页、导出的 CSV 都要用，
// 各算一遍就会出现三个页面三种说法。
import { describeSignupSource } from "@/lib/signup-source"
import { desc, eq, and, gte, inArray, isNotNull, or, like, sql, type SQL } from "drizzle-orm"

/**
 * 后台「用户管理」列表。
 *
 * 带出「这个人都干了什么」—— 练习句数、埋点数、已付订单数，
 * 让列表页能一眼分辨"真在用的用户"与"注册完就没来过的"。
 *
 * 钻取（仪表盘指标点进来的落点）支持四个参数，与 lib/admin-drilldown 的词汇表一致：
 *   range=week|month|quarter|all —— 时间窗口。**window 作用在哪个字段上由同时出现的
 *                                   标志决定**，见下面 applyWindow 的说明
 *   active=1                     —— 该窗口内练过至少一句（对应「活跃用户」）
 *   trial=1                      —— 该窗口内领取过体验会员（对应「领取体验会员」）
 *   pro=1                        —— 当前是会员
 * `range` 缺省表示**不加时间条件**（列表页默认看全部），这与仪表盘上选「不限」
 * 是两件事，所以不能套用 parseRange 的默认值 week —— 否则直接打开用户列表
 * 会莫名其妙只剩近一周的人。
 *
 * ⚠️ range 的含义必须跟着指标走，不能一律当成"注册时间"：
 *   「活跃用户」问的是"**这段时间练过的人**"，与他是哪天注册的无关。
 *   如果把 range 一律作用在注册时间上，一个 60 天前注册、昨天才第一次练的用户
 *   会被排除掉 —— 而那恰恰是"活跃"最该抓到的人。这类错误的表现是
 *   列表条数少于卡片上的数字，看起来像仪表盘算错了。
 *   所以：带 active / trial 时，range 作用在**行为时间**上；都不带时才作用在注册时间上。
 *
 * ⚠️ 统计**不能**写成相关子查询的形式：
 *
 *     sql`(SELECT COUNT(*) FROM ${practiceRecords} WHERE ${practiceRecords.userId} = ${users.id})`
 *
 * 看起来对，实际生成的 SQL 是 `(SELECT COUNT(*) FROM `practice_records`
 * WHERE `user_id` = `id`)` —— Drizzle 在单表查询里会把列名**去掉表限定**，
 * 于是 `id` 解析成子查询自己的 `practice_records.id`，与外层 users 行毫无关系，
 * 结果恒为错值（实测全部为 0）。这类错误不报错、页面也正常渲染，只是数字是假的。
 *
 * 因此改成：先取当页用户（≤100 行），再用三条按 user_id 分组、带 inArray 的聚合，
 * 在 JS 里按 userId 合并。`active=1` 的筛选同理 —— 用「子查询 + inArray」，
 * 而不是在 EXISTS 里引用外层列。
 */
export async function GET(request: Request) {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth
  if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })
  const database = db

  const { searchParams } = new URL(request.url)
  const { pageSize, offset } = parsePagination(searchParams)
  const q = (searchParams.get("q") ?? "").trim().slice(0, 64)

  // 显式判断"参数是否存在"，而不是 parseRange（它会把缺省当成 week）
  const rawRange = searchParams.get("range")
  const range = rawRange ? parseRange(rawRange) : null
  const from = range ? rangeStart(range) : null
  const active = searchParams.get("active") === "1"
  const trial = searchParams.get("trial") === "1"
  const proOnly = searchParams.get("pro") === "1"

  const conditions: SQL[] = []
  if (q) {
    const nameOrPhone = or(like(users.name, `%${q}%`), like(users.phone, `%${q}%`))
    if (nameOrPhone) conditions.push(nameOrPhone)
  }

  // 只有"没有行为标志"时，range 才作用在注册时间上（对应「新增用户」）
  if (from && !active && !trial) conditions.push(gte(users.createdAt, from))

  if (trial) {
    // 没有窗口时必须退化成"领过就行"（IS NOT NULL）。
    // 这里曾经写成 `if (trial && from)`，于是 range=all 时整个条件被静默丢掉，
    // 从没领过的人（trial_claimed_at 为 NULL）也会被列出来
    conditions.push(from ? gte(users.trialClaimedAt, from) : isNotNull(users.trialClaimedAt))
  }

  if (proOnly) conditions.push(eq(users.isPro, 1))

  if (active) {
    // 「这个时间范围内练过」= 练习记录的时间落在窗口内，而不是用户的注册时间
    const practiced = database
      .select({ userId: practiceRecords.userId })
      .from(practiceRecords)
      .where(from ? gte(practiceRecords.createdAt, from) : undefined)
    conditions.push(inArray(users.id, practiced))
  }

  const where: SQL | undefined = conditions.length > 0 ? and(...conditions) : undefined

  const [pageUsers, [{ total }]] = await Promise.all([
    database
      .select({
        id: users.id,
        name: users.name,
        phone: users.phone,
        isPro: users.isPro,
        role: users.role,
        level: users.level,
        diamonds: users.diamonds,
        isPartner: users.isPartner,
        referredBy: users.referredBy,
        wechatOpenid: users.wechatOpenid,
        trialClaimedAt: users.trialClaimedAt,
        proExpires: users.proExpires,
        // 注册来源：列表页要能一眼看出"这个人从哪来的"
        signupChannel: users.signupChannel,
        signupSource: users.signupSource,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(where)
      .orderBy(desc(users.createdAt))
      .limit(pageSize)
      .offset(offset),
    database.select({ total: sql<number>`count(*)` }).from(users).where(where),
  ])

  const ids = pageUsers.map((u) => u.id)

  const toMap = (rows: Array<{ userId: string; n: number }>) =>
    new Map(rows.map((r) => [r.userId, Number(r.n)]))

  let practiceMap = new Map<string, number>()
  let eventMap = new Map<string, number>()
  let paidMap = new Map<string, number>()

  if (ids.length > 0) {
    const [practiceRows, eventRows, paidRows] = await Promise.all([
      database
        .select({ userId: practiceRecords.userId, n: sql<number>`COUNT(*)` })
        .from(practiceRecords)
        .where(inArray(practiceRecords.userId, ids))
        .groupBy(practiceRecords.userId),
      database
        .select({ userId: analyticsEvents.userId, n: sql<number>`COUNT(*)` })
        .from(analyticsEvents)
        .where(inArray(analyticsEvents.userId, ids))
        .groupBy(analyticsEvents.userId),
      database
        .select({ userId: paymentOrders.userId, n: sql<number>`COUNT(*)` })
        .from(paymentOrders)
        .where(and(inArray(paymentOrders.userId, ids), eq(paymentOrders.status, "paid")))
        .groupBy(paymentOrders.userId),
    ])
    practiceMap = toMap(practiceRows as Array<{ userId: string; n: number }>)
    // analytics_events.user_id 可空（匿名事件），这里只统计到人
    eventMap = toMap(
      (eventRows as Array<{ userId: string | null; n: number }>).filter(
        (r): r is { userId: string; n: number } => r.userId != null,
      ),
    )
    paidMap = toMap(paidRows as Array<{ userId: string; n: number }>)
  }

  return NextResponse.json({
    data: pageUsers.map((u) => ({
      ...u,
      hasWechat: u.wechatOpenid != null,
      // 不把 openid 原文发给前端
      wechatOpenid: undefined,
      // 原始 JSON 之外再给一个算好的摘要，前端直接渲染，不必重复实现优先级规则
      signupLabel: describeSignupSource(u.signupChannel, u.signupSource),
      practiceCount: practiceMap.get(u.id) ?? 0,
      eventCount: eventMap.get(u.id) ?? 0,
      paidOrderCount: paidMap.get(u.id) ?? 0,
    })),
    total: Number(total),
    // 回显生效的口径：界面的提示条据此说明"这批数字是怎么筛出来的"，
    // 也避免接口悄悄把 range 解析成别的档位而前端无从发现
    appliedRange: range,
    appliedRangeLabel: range ? rangeLabel(range) : null,
  })
}
