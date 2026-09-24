import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { paymentOrders } from "@/lib/db/schema"
import { requireAdmin } from "@/lib/admin-auth"
import { parsePagination } from "@/lib/pagination"
import { desc, sql } from "drizzle-orm"

export async function GET(request: Request) {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth
  if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })

  const { searchParams } = new URL(request.url)
  const { pageSize, offset } = parsePagination(searchParams)

  const [rows, [{ total }]] = await Promise.all([
    // 订单列表按时间倒序：最新的一笔要在第一页。此前是升序，
    // 订单多起来之后管理员得翻到最后一页才能看到刚刚的支付。
    db
      .select()
      .from(paymentOrders)
      .orderBy(desc(paymentOrders.createdAt))
      .limit(pageSize)
      .offset(offset),
    db.select({ total: sql<number>`count(*)` }).from(paymentOrders),
  ])

  return NextResponse.json({ data: rows, total })
}
