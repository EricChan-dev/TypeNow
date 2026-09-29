import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { paymentOrders, users } from "@/lib/db/schema"
import { requireAdmin } from "@/lib/admin-auth"
import { activeProSql } from "@/lib/subscription"
import { parsePagination } from "@/lib/pagination"
import { parseRangeQuery, resolveRange } from "@/lib/admin-range"
import { desc, eq, and, gte, lte, or, like, sql, type SQL } from "drizzle-orm"

/**
 * 后台「支付订单」列表。
 *
 * 三个增强：
 *   1. LEFT JOIN users，带出下单人的姓名、手机号与会员状态 —— 原先只返回 user_id，
 *      管理员看到一串 UUID，既不知道是谁付的，也没法顺着查这个人。
 *   2. `q` 搜索：订单号 / 用户姓名 / 手机号，三者任一命中。
 *   3. 钻取（仪表盘「付费订单」「收入」点进来的落点）：
 *      `range` 按**支付时间**筛，`status` 按订单状态筛。
 *      从仪表盘进来时带 `status=paid` —— 那两个指标只统计已支付订单，
 *      不带的话列表里混着待支付/已失败的订单，条数会多于指标上的数字，
 *      看起来就像"报表算错了"。
 *
 * `range` 走 paid_at 而不是 created_at：收入的归属期看的是"什么时候收到的钱"。
 * 副作用是 pending 订单（paid_at 为 NULL）在带 range 时不会出现，这是正确的
 * ——它们本来就不计入收入。未支付订单请用 `status=pending` 单独查。
 *
 * 返回**驼峰**字段（Drizzle 属性名），页面 dataIndex 必须用驼峰 ——
 * 此前页面用的是 out_trade_no / created_at / paid_at，导致整列空白。
 */
/** 与 schema 的 payment_orders.status 枚举一一对应。 */
type OrderStatus = "pending" | "paid" | "expired" | "cancelled"
const ORDER_STATUSES: readonly string[] = ["pending", "paid", "expired", "cancelled"]

export async function GET(request: Request) {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth
  if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })
  const database = db

  const { searchParams } = new URL(request.url)
  const { pageSize, offset } = parsePagination(searchParams)
  const q = (searchParams.get("q") ?? "").trim().slice(0, 64)
  const rangeQuery = parseRangeQuery(searchParams)
  const range = rangeQuery ? resolveRange(rangeQuery) : null
  const from = range?.start ?? null
  // 上界：预设窗口都是"到现在"，只有自定义范围才有终点
  const to = range?.end ?? null
  // 只接受 schema 里真实存在的枚举值：把任意字符串透进查询虽然会被参数化
  // （无注入风险），但会静默筛出空表，使用者分不清是"没有这类订单"还是
  // "状态名写错了"。这里的清单必须与 schema 的 mysqlEnum 完全一致，
  // 写错（比如凭直觉写 failed/refunded）同样只会得到空列表。
  const rawStatus = (searchParams.get("status") ?? "").trim().slice(0, 20)
  const status: OrderStatus | "" = ORDER_STATUSES.includes(rawStatus as OrderStatus)
    ? (rawStatus as OrderStatus)
    : ""

  const conditions: SQL[] = []
  if (q) {
    const matched = or(
      like(paymentOrders.outTradeNo, `%${q}%`),
      like(users.name, `%${q}%`),
      like(users.phone, `%${q}%`),
    )
    if (matched) conditions.push(matched)
  }
  if (from) conditions.push(gte(paymentOrders.paidAt, from))
  if (to) conditions.push(lte(paymentOrders.paidAt, to))
  if (status) conditions.push(eq(paymentOrders.status, status))
  const where: SQL | undefined = conditions.length > 0 ? and(...conditions) : undefined

  const [rows, countRows] = await Promise.all([
    database
      .select({
        id: paymentOrders.id,
        userId: paymentOrders.userId,
        plan: paymentOrders.plan,
        amount: paymentOrders.amount,
        status: paymentOrders.status,
        transactionId: paymentOrders.transactionId,
        outTradeNo: paymentOrders.outTradeNo,
        paidAt: paymentOrders.paidAt,
        createdAt: paymentOrders.createdAt,
        userName: users.name,
        userPhone: users.phone,
        userIsPro: activeProSql(),
      })
      .from(paymentOrders)
      .leftJoin(users, eq(paymentOrders.userId, users.id))
      .where(where)
      .orderBy(desc(paymentOrders.createdAt))
      .limit(pageSize)
      .offset(offset),
    database
      .select({
        total: sql<number>`count(*)`,
        // 同口径金额合计：从「收入」钻进来时列表能对账。
        // 只对已支付求和才有意义，所以这里是 CASE 而不是直接 SUM(amount)
        paidFen: sql<number>`COALESCE(SUM(CASE WHEN ${paymentOrders.status} = 'paid' THEN ${paymentOrders.amount} ELSE 0 END), 0)`,
      })
      .from(paymentOrders)
      .leftJoin(users, eq(paymentOrders.userId, users.id))
      .where(where),
  ])

  const countRow = countRows[0]

  return NextResponse.json({
    data: rows,
    total: Number(countRow?.total ?? 0),
    paidFen: Number(countRow?.paidFen ?? 0),
    // 回显生效口径（同 users 接口）
    appliedRange: range,
    appliedRangeLabel: range?.label ?? null,
  })
}
