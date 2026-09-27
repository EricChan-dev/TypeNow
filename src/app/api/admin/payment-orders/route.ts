import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { paymentOrders, users } from "@/lib/db/schema"
import { requireAdmin } from "@/lib/admin-auth"
import { parsePagination } from "@/lib/pagination"
import { desc, eq, or, like, sql, type SQL } from "drizzle-orm"

/**
 * 后台「支付订单」列表。
 *
 * 两个增强（都是为了「能追溯到人」）：
 *   1. LEFT JOIN users，带出下单人的姓名、手机号与会员状态 —— 原先只返回 user_id，
 *      管理员看到一串 UUID，既不知道是谁付的，也没法顺着查这个人。
 *   2. `q` 搜索：订单号 / 用户姓名 / 手机号，三者任一命中。
 *
 * 返回**驼峰**字段（Drizzle 属性名），页面 dataIndex 必须用驼峰 ——
 * 此前页面用的是 out_trade_no / created_at / paid_at，导致整列空白。
 */
export async function GET(request: Request) {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth
  if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })

  const { searchParams } = new URL(request.url)
  const { pageSize, offset } = parsePagination(searchParams)
  const q = (searchParams.get("q") ?? "").trim().slice(0, 64)

  const where: SQL | undefined = q
    ? or(
        like(paymentOrders.outTradeNo, `%${q}%`),
        like(users.name, `%${q}%`),
        like(users.phone, `%${q}%`),
      )
    : undefined

  const [rows, [{ total }]] = await Promise.all([
    db
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
        userIsPro: users.isPro,
      })
      .from(paymentOrders)
      .leftJoin(users, eq(paymentOrders.userId, users.id))
      .where(where)
      .orderBy(desc(paymentOrders.createdAt))
      .limit(pageSize)
      .offset(offset),
    db
      .select({ total: sql<number>`count(*)` })
      .from(paymentOrders)
      .leftJoin(users, eq(paymentOrders.userId, users.id))
      .where(where),
  ])

  return NextResponse.json({ data: rows, total: Number(total) })
}
