import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { subscriptions, users } from "@/lib/db/schema"
import { requireAdmin } from "@/lib/admin-auth"
import { parsePagination } from "@/lib/pagination"
import { parseRange, rangeStart, rangeLabel } from "@/lib/admin-range"
import { activeSubscriptionSql, isSubscriptionActive } from "@/lib/subscription"
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
 * ⚠️ `status=active` 表示**此刻仍然生效**（`status='active'` 且未到期），
 * 与仪表盘「活跃订阅」卡片共用 lib/subscription 的 activeSubscriptionSql()。
 * 此前两处都直接读 status 列，于是"到期但没被回收"的行会被算成活跃订阅 ——
 * 而回收只发生在 checkAndExpirePro 被调用时，再也不回来的用户永远不会被回收。
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
  // status=active 的语义是**此刻仍然生效**，而不是"状态列写着 active"：
  // 到期未清理的行会一直挂着 active，仪表盘「活跃订阅」卡片与这里的
  // 钻取必须算同一个数（有 e2e 钉着这条不变量）。
  // 需要看"状态列恰好是 active"的行（含到期的）时不带 status 筛选即可 ——
  // 列表里会把它们标成「已过期(未清理)」，不会凭空消失。
  if (status === "active") conditions.push(activeSubscriptionSql())
  else if (status) conditions.push(eq(subscriptions.status, status))
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
    // effectiveStatus：给列表显示用。status=active 但已过期的行标出来，
    // 否则它们在"生效中"筛选下消失、在别处又与普通 active 无法区分
    data: rows.map((r) => ({
      ...r,
      effectiveStatus: isSubscriptionActive(r) ? "active" : r.status === "active" ? "expired_stale" : r.status,
    })),
    total: Number(total),
    appliedRange: range,
    appliedRangeLabel: range ? rangeLabel(range) : null,
  })
}
