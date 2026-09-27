import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { subscriptions } from "@/lib/db/schema"
import { requireAdmin } from "@/lib/admin-auth"
import { parsePagination } from "@/lib/pagination"
import { desc, sql } from "drizzle-orm"

/**
 * 后台「订阅管理」列表。
 *
 * 这个接口此前**根本不存在**，但两处都在调它：
 *   - /admin/subscriptions 页面（refine useTable → GET /api/admin/subscriptions）
 *   - /admin 仪表盘（Promise.all 里的一个）
 * 后果不只是订阅页空表：仪表盘把四个请求的 .json() 一起 Promise.all，
 * 404 返回的是 HTML，.json() 直接抛错 → 整个仪表盘都加载不出来。
 *
 * 返回**驼峰**字段（Drizzle 的 JS 属性名）。这是后台列表接口的事实约定：
 * courses / sentences / lessons / users / payment-orders 全都返回驼峰，
 * 页面绑定的 dataIndex 也必须用驼峰 —— 底下那几个页面前缀用了下划线写法，
 * 表现为对应列为空白（见本文件的配套修复）。
 */
export async function GET(request: Request) {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth
  if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })

  const { searchParams } = new URL(request.url)
  const { pageSize, offset } = parsePagination(searchParams)

  const [rows, [{ total }]] = await Promise.all([
    // 最新的订阅排在最前，与支付订单列表一致
    db
      .select()
      .from(subscriptions)
      .orderBy(desc(subscriptions.createdAt))
      .limit(pageSize)
      .offset(offset),
    db.select({ total: sql<number>`count(*)` }).from(subscriptions),
  ])

  return NextResponse.json({ data: rows, total })
}
