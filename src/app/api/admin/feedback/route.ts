import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { userFeedback, users } from "@/lib/db/schema"
import { requireAdmin } from "@/lib/admin-auth"
import { activeProSql } from "@/lib/subscription"
import { parsePagination } from "@/lib/pagination"
import { parseRange, rangeStart, rangeLabel } from "@/lib/admin-range"
import { deletedScope } from "@/lib/soft-delete-view"
import { maskPhone } from "@/lib/mask"
import {
  FEEDBACK_CATEGORIES,
  FEEDBACK_STATUSES,
  OPEN_FEEDBACK_STATUSES,
  isFeedbackCategory,
  isFeedbackStatus,
  type FeedbackStatus,
} from "@/lib/feedback"
import { and, desc, eq, gte, inArray, like, or, sql, type SQL } from "drizzle-orm"

/**
 * 后台「反馈管理」列表。
 *
 * 这个接口补的是**从上线起就缺的那一环**：user_feedback 一直只有写入路径，
 * 反馈只以一条微信客服消息的形式推给管理员，消息一滚过去就找不回来了 ——
 * 线上实测已经积了 8 条没人看过。
 *
 * 筛选与仪表盘「待处理反馈」共用状态口径（OPEN_FEEDBACK_STATUSES 含"处理中"），
 * 否则卡片上的数字和点进来的列表条数对不上。
 *
 * `q` 同时搜反馈内容、用户昵称与手机号：运营拿到一句用户原话时，
 * 第一反应往往是想知道"这是谁提的"。
 */
export async function GET(request: Request) {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth
  if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })
  const database = db

  const { searchParams } = new URL(request.url)
  const { pageSize, offset } = parsePagination(searchParams)
  const q = (searchParams.get("q") ?? "").trim().slice(0, 100)

  // status 支持单值；也支持 `status=unfinished` 这个聚合档（待处理 + 处理中），
  // 因为仪表盘那张卡片就是按它计数的
  const rawStatus = (searchParams.get("status") ?? "").trim()
  const statusFilter: FeedbackStatus[] =
    rawStatus === "unfinished"
      ? OPEN_FEEDBACK_STATUSES
      : isFeedbackStatus(rawStatus)
        ? [rawStatus]
        : []

  const rawCategory = (searchParams.get("category") ?? "").trim()
  const category = isFeedbackCategory(rawCategory) ? rawCategory : null

  const rawRange = searchParams.get("range")
  const range = rawRange ? parseRange(rawRange) : null
  const from = range ? rangeStart(range) : null

  // 复用回收站视图模块的解析，让 ?deleted= 的行为与其它列表一致
  // （反馈不参与软删除，这里只取 normal 语义，deleted=only 时返回空）
  const view = deletedScope(searchParams.get("deleted"))

  const conditions: SQL[] = []

  if (view === "only") {
    // 反馈表没有软删除列：明确返回空，而不是悄悄当成"全部"把数据漏出来
    return NextResponse.json({ data: [], total: 0, summary: emptySummary() })
  }

  if (statusFilter.length > 0) conditions.push(inArray(userFeedback.status, statusFilter))
  if (category) conditions.push(eq(userFeedback.category, category))
  if (from) conditions.push(gte(userFeedback.createdAt, from))
  if (q) {
    const matched = or(
      like(userFeedback.content, `%${q}%`),
      like(users.name, `%${q}%`),
      like(users.phone, `%${q}%`),
    )
    if (matched) conditions.push(matched)
  }

  const where: SQL | undefined = conditions.length > 0 ? and(...conditions) : undefined

  const [rows, countRows, summaryRows] = await Promise.all([
    database
      .select({
        id: userFeedback.id,
        userId: userFeedback.userId,
        category: userFeedback.category,
        source: userFeedback.source,
        status: userFeedback.status,
        content: userFeedback.content,
        adminNote: userFeedback.adminNote,
        handledBy: userFeedback.handledBy,
        handledAt: userFeedback.handledAt,
        createdAt: userFeedback.createdAt,
        userName: users.name,
        userPhone: users.phone,
        userIsPro: activeProSql(),
      })
      .from(userFeedback)
      // LEFT JOIN：用户若被删（历史数据），反馈本身不该跟着消失
      .leftJoin(users, eq(userFeedback.userId, users.id))
      .where(where)
      .orderBy(desc(userFeedback.createdAt))
      .limit(pageSize)
      .offset(offset),

    database
      .select({ total: sql<number>`count(*)` })
      .from(userFeedback)
      .leftJoin(users, eq(userFeedback.userId, users.id))
      .where(where),

    /**
     * 各状态条数。**不带筛选条件**（除了回收站视图），因为它要回答的是
     * "总共有多少没处理" —— 带上当前筛选的话，切到"已解决"档时
     * 「待处理」就变成 0 了，那是错的。
     */
    database
      .select({ status: userFeedback.status, n: sql<number>`count(*)` })
      .from(userFeedback)
      .groupBy(userFeedback.status),
  ])

  const byStatus: Record<string, number> = {}
  for (const s of FEEDBACK_STATUSES) byStatus[s] = 0
  for (const r of summaryRows) byStatus[r.status] = Number(r.n)
  const unfinished = OPEN_FEEDBACK_STATUSES.reduce((sum, s) => sum + (byStatus[s] ?? 0), 0)

  return NextResponse.json({
    data: rows.map((r) => ({ ...r, userPhone: maskPhone(r.userPhone) })),
    total: Number(countRows[0]?.total ?? 0),
    summary: { byStatus, unfinished, categories: [...FEEDBACK_CATEGORIES] },
    appliedRange: range,
    appliedRangeLabel: range ? rangeLabel(range) : null,
  })
}

function emptySummary() {
  const byStatus: Record<string, number> = {}
  for (const s of FEEDBACK_STATUSES) byStatus[s] = 0
  return { byStatus, unfinished: 0, categories: [...FEEDBACK_CATEGORIES] }
}
