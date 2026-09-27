import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { subscriptions, users } from "@/lib/db/schema"
import { requireAdmin } from "@/lib/admin-auth"
import { parsePagination } from "@/lib/pagination"
import { parseRange, rangeStart, rangeLabel } from "@/lib/admin-range"
import { desc, eq, and, gte, or, like, sql, type SQL } from "drizzle-orm"

/**
 * 后台「订阅管理」列表。
 *
 * 这个接口此前**根本不存在**，但订阅页与 /admin 仪表盘都在调它；
 * 404 返回 HTML 会让仪表盘的 Promise.all 整体抛错（详见 commit 说明）。
 *
 * 与支付订单一致，这里也 JOIN users 带出订阅人信息，并支持 `q` 搜索，
 * 让「这条订阅是谁的」可以直接看到、并跳转到用户详情。
 *
 * 钻取（仪表盘「活跃订阅」点进来的落点）：
 *   status=active —— 仪表盘那个数只统计生效中的订阅，不带这个条件条数会对不上
 *   range         —— 按**创建时间**筛（"这段时间新增了多少订阅"）
 *
 * 注意 status 是精确匹配：`active` 表示"状态字段是 active"，**不**等于
 * "此刻还在有效期内"。到期未清理的行仍会留在 active 上，所以这里回显的
 * 口径与仪表盘一致（两处都读 status），不会出现两个页面数字不同的情况。
 */
/** 与 schema 的 subscriptions.status 枚举一一对应。 */
type SubStatus = "active" | "cancelled" | "expired"
const SUB_STATUSES: readonly string[] = ["active", "cancelled", "expired"]

export async function GET(request: Request) {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth
  if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })
  const database = db

  const { searchParams } = new URL(request.url)
  const { pageSize, offset } = parsePagination(searchParams)
  const q = (searchParams.get("q") ?? "").trim().slice(0, 64)
  const rawRange = searchParams.get("range")
  const range = rawRange ? parseRange(rawRange) : null
  const from = range ? rangeStart(range) : null
  // 清单与 schema 的 subscriptions.status 枚举完全一致（没有 pending）
  const rawStatus = (searchParams.get("status") ?? "").trim().slice(0, 20)
  const status: SubStatus | "" = SUB_STATUSES.includes(rawStatus as SubStatus)
    ? (rawStatus as SubStatus)
    : ""

  const conditions: SQL[] = []
  if (q) {
    const matched = or(like(users.name, `%${q}%`), like(users.phone, `%${q}%`))
    if (matched) conditions.push(matched)
  }
  if (from) conditions.push(gte(subscriptions.createdAt, from))
  if (status) conditions.push(eq(subscriptions.status, status))
  const where: SQL | undefined = conditions.length > 0 ? and(...conditions) : undefined

  const [rows, [{ total }]] = await Promise.all([
    database
      .select({
        id: subscriptions.id,
        userId: subscriptions.userId,
        plan: subscriptions.plan,
        status: subscriptions.status,
        paymentOrderId: subscriptions.paymentOrderId,
        startsAt: subscriptions.startsAt,
        expiresAt: subscriptions.expiresAt,
        cancelledAt: subscriptions.cancelledAt,
        createdAt: subscriptions.createdAt,
        userName: users.name,
        userPhone: users.phone,
      })
      .from(subscriptions)
      .leftJoin(users, eq(subscriptions.userId, users.id))
      .where(where)
      .orderBy(desc(subscriptions.createdAt))
      .limit(pageSize)
      .offset(offset),
    database
      .select({ total: sql<number>`count(*)` })
      .from(subscriptions)
      .leftJoin(users, eq(subscriptions.userId, users.id))
      .where(where),
  ])

  return NextResponse.json({
    data: rows,
    total: Number(total),
    appliedRange: range,
    appliedRangeLabel: range ? rangeLabel(range) : null,
  })
}
