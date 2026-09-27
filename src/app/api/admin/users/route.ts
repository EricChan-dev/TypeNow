import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { analyticsEvents, paymentOrders, practiceRecords, users } from "@/lib/db/schema"
import { requireAdmin } from "@/lib/admin-auth"
import { parsePagination } from "@/lib/pagination"
import { desc, eq, and, inArray, or, like, sql, type SQL } from "drizzle-orm"

/**
 * 后台「用户管理」列表。
 *
 * 增强：`q` 搜索（昵称 / 手机号），并带出「这个人都干了什么」——
 * 练习句数、埋点数、已付订单数，让列表页能一眼分辨"真在用的用户"与"注册完就没来过的"。
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
 * 在 JS 里按 userId 合并。语义直白、可用索引，也不会随行数产生 N 次子查询。
 */
export async function GET(request: Request) {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth
  if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })

  const { searchParams } = new URL(request.url)
  const { pageSize, offset } = parsePagination(searchParams)
  const q = (searchParams.get("q") ?? "").trim().slice(0, 64)

  const where: SQL | undefined = q
    ? or(like(users.name, `%${q}%`), like(users.phone, `%${q}%`))
    : undefined

  const [pageUsers, [{ total }]] = await Promise.all([
    db
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
        createdAt: users.createdAt,
      })
      .from(users)
      .where(where)
      .orderBy(desc(users.createdAt))
      .limit(pageSize)
      .offset(offset),
    db.select({ total: sql<number>`count(*)` }).from(users).where(where),
  ])

  const ids = pageUsers.map((u) => u.id)

  const toMap = (rows: Array<{ userId: string; n: number }>) =>
    new Map(rows.map((r) => [r.userId, Number(r.n)]))

  let practiceMap = new Map<string, number>()
  let eventMap = new Map<string, number>()
  let paidMap = new Map<string, number>()

  if (ids.length > 0) {
    const [practiceRows, eventRows, paidRows] = await Promise.all([
      db
        .select({ userId: practiceRecords.userId, n: sql<number>`COUNT(*)` })
        .from(practiceRecords)
        .where(inArray(practiceRecords.userId, ids))
        .groupBy(practiceRecords.userId),
      db
        .select({ userId: analyticsEvents.userId, n: sql<number>`COUNT(*)` })
        .from(analyticsEvents)
        .where(inArray(analyticsEvents.userId, ids))
        .groupBy(analyticsEvents.userId),
      db
        .select({ userId: paymentOrders.userId, n: sql<number>`COUNT(*)` })
        .from(paymentOrders)
        .where(and(inArray(paymentOrders.userId, ids), eq(paymentOrders.status, "paid")))
        .groupBy(paymentOrders.userId),
    ])
    practiceMap = toMap(practiceRows as Array<{ userId: string; n: number }>)
    // analytics_events.user_id 可空（匿名事件），这里只统计到人
    eventMap = toMap((eventRows as Array<{ userId: string | null; n: number }>).filter(
      (r): r is { userId: string; n: number } => r.userId != null,
    ))
    paidMap = toMap(paidRows as Array<{ userId: string; n: number }>)
  }

  return NextResponse.json({
    data: pageUsers.map((u) => ({
      ...u,
      hasWechat: u.wechatOpenid != null,
      // 不把 openid 原文发给前端
      wechatOpenid: undefined,
      practiceCount: practiceMap.get(u.id) ?? 0,
      eventCount: eventMap.get(u.id) ?? 0,
      paidOrderCount: paidMap.get(u.id) ?? 0,
    })),
    total: Number(total),
  })
}
