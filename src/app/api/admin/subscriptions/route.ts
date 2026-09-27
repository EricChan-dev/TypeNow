import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { subscriptions, users } from "@/lib/db/schema"
import { requireAdmin } from "@/lib/admin-auth"
import { parsePagination } from "@/lib/pagination"
import { desc, eq, or, like, sql, type SQL } from "drizzle-orm"

/**
 * 后台「订阅管理」列表。
 *
 * 这个接口此前**根本不存在**，但订阅页与 /admin 仪表盘都在调它；
 * 404 返回 HTML 会让仪表盘的 Promise.all 整体抛错（详见 commit 说明）。
 *
 * 与支付订单一致，这里也 JOIN users 带出订阅人信息，并支持 `q` 搜索，
 * 让「这条订阅是谁的」可以直接看到、并跳转到用户详情。
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

  const [rows, [{ total }]] = await Promise.all([
    db
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
    db
      .select({ total: sql<number>`count(*)` })
      .from(subscriptions)
      .leftJoin(users, eq(subscriptions.userId, users.id))
      .where(where),
  ])

  return NextResponse.json({ data: rows, total: Number(total) })
}
