import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { aiChatLogs, users } from "@/lib/db/schema"
import { requireAdmin } from "@/lib/admin-auth"
import { parsePagination } from "@/lib/pagination"
import { parseRangeQuery, resolveRange } from "@/lib/admin-range"
import { maskPhone } from "@/lib/mask"
import { and, desc, eq, gte, like, lte, or, sql, type SQL } from "drizzle-orm"

/**
 * AI 私教对话日志（只读审计）。
 *
 * 为什么需要它：AI 对话此前**完全不落库**，只有 diamond_logs 记了"扣了多少钻石"。
 * 于是这三类问题一个都答不了：
 *   · 用户投诉"AI 答得不对/答非所问"—— 看不到当时问了什么、答了什么；
 *   · 怀疑有人在刷免费额度或钻石 —— 看不到谁在什么时候问了多少次；
 *   · 想评估回答质量或模型是否变慢 —— 没有耗时与失败率可看。
 *
 * 口径：
 *   · **只读**。与操作审计同样刻意不提供"清理日志"入口 —— 能在界面上删掉的
 *     审计日志不算审计；真要归档应由 DBA 在库上做。
 *   · 只记到 LLM 的请求（成功与失败各一条）。鉴权失败、超长、额度不足这类
 *     前置拒绝不在这里，它们不是 AI 使用记录。
 *   · 刻意不返回 question/answer 的**全文**以外的衍生字段（如 IP）——
 *     这张表没存 IP，也就无从泄露。
 */
export async function GET(request: Request) {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth
  if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })
  const database = db

  const { searchParams } = new URL(request.url)
  const { pageSize, offset } = parsePagination(searchParams)
  const q = (searchParams.get("q") ?? "").trim().slice(0, 100)
  const userId = (searchParams.get("userId") ?? "").trim().slice(0, 36) || null

  const rawStatus = (searchParams.get("status") ?? "").trim()
  const status = rawStatus === "ok" || rawStatus === "error" ? rawStatus : null

  // 时间范围与仪表盘/其它后台列表共用同一份定义，否则「近一周」在两个页面上
  // 会指向不同区间（这正是把 range 收敛成模块的原因）
  const rangeQuery = parseRangeQuery(searchParams)
  const range = rangeQuery ? resolveRange(rangeQuery) : null
  const from = range?.start ?? null
  const to = range?.end ?? null

  const conds: SQL[] = []
  if (userId) conds.push(eq(aiChatLogs.userId, userId))
  if (status) conds.push(eq(aiChatLogs.status, status))
  if (from) conds.push(gte(aiChatLogs.createdAt, from))
  if (to) conds.push(lte(aiChatLogs.createdAt, to))
  if (q) {
    // 关键词同时匹配"谁问的"和"问了什么"：查投诉时两种入口都需要
    // （知道是谁、但记不清原话；或记得一句话、不知道是谁）
    const matched = or(
      like(users.name, `%${q}%`),
      like(users.phone, `%${q}%`),
      like(aiChatLogs.question, `%${q}%`),
    )
    if (matched) conds.push(matched)
  }
  const where = conds.length === 0 ? undefined : conds.length === 1 ? conds[0] : and(...conds)

  // 分页第二个排序键是稳定分页所必需的：同一秒内可能多条，
  // 只按 created_at 排序时 MySQL 不保证翻页顺序一致（埋点列表踩过同一个坑）。
  const [rows, [countRow]] = await Promise.all([
    database
      .select({
        id: aiChatLogs.id,
        createdAt: aiChatLogs.createdAt,
        userId: aiChatLogs.userId,
        userName: users.name,
        userPhone: users.phone,
        question: aiChatLogs.question,
        answer: aiChatLogs.answer,
        model: aiChatLogs.model,
        historyCount: aiChatLogs.historyCount,
        diamondsCost: aiChatLogs.diamondsCost,
        usedFreeQuota: aiChatLogs.usedFreeQuota,
        status: aiChatLogs.status,
        errorMessage: aiChatLogs.errorMessage,
        latencyMs: aiChatLogs.latencyMs,
      })
      .from(aiChatLogs)
      .leftJoin(users, eq(users.id, aiChatLogs.userId))
      .where(where)
      .orderBy(desc(aiChatLogs.createdAt), desc(aiChatLogs.id))
      .limit(pageSize)
      .offset(offset),
    database
      .select({ total: sql<number>`count(*)` })
      .from(aiChatLogs)
      .leftJoin(users, eq(users.id, aiChatLogs.userId))
      .where(where),
  ])

  // 汇总必须带上与列表**完全相同**的 join：where 里可能引用 users.name/phone
  // （关键词筛选），少一个 join 就会变成 "Unknown column 'users.name'" 的 500。
  // 这个错是 e2e 抓到的 —— 手工点页面时只会看到"加载失败"。
  const [summary] = await database
    .select({
      total: sql<number>`count(*)`,
      errors: sql<number>`sum(case when ${aiChatLogs.status} = 'error' then 1 else 0 end)`,
      freeQuota: sql<number>`sum(case when ${aiChatLogs.usedFreeQuota} = 1 then 1 else 0 end)`,
      diamonds: sql<number>`sum(${aiChatLogs.diamondsCost})`,
      avgLatency: sql<number>`round(avg(${aiChatLogs.latencyMs}))`,
    })
    .from(aiChatLogs)
    .leftJoin(users, eq(users.id, aiChatLogs.userId))
    .where(where)

  return NextResponse.json({
    data: rows.map((r) => ({
      ...r,
      // 与其它后台列表一致：手机号只出中间脱敏形式
      userPhone: r.userPhone ? maskPhone(r.userPhone) : null,
    })),
    total: Number(countRow?.total ?? 0),
    // 汇总按当前筛选口径算：回答"这段时间里失败率多少、平均多慢、花了多少钻石"
    summary: {
      total: Number(summary?.total ?? 0),
      errors: Number(summary?.errors ?? 0),
      freeQuota: Number(summary?.freeQuota ?? 0),
      diamonds: Number(summary?.diamonds ?? 0),
      avgLatency: summary?.avgLatency === null ? null : Number(summary?.avgLatency ?? 0),
    },
    // 回显生效的筛选，便于前端在"筛了但结果为空"时说明原因
    applied: { q, userId, status, range: range?.range ?? null, rangeLabel: range?.label ?? null },
  })
}
