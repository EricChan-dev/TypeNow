import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { practiceRecords, sentences, users } from "@/lib/db/schema"
import { requireAdmin } from "@/lib/admin-auth"
import { parsePagination } from "@/lib/pagination"
import { parseRangeQuery, resolveRange } from "@/lib/admin-range"
import { maskPhone } from "@/lib/mask"
import { desc, eq, and, gte, lte, or, like, sql, type SQL } from "drizzle-orm"

/**
 * 后台「练习记录」列表。
 *
 * 为什么需要这一页：仪表盘上的「练习句数」是一个只读指标 —— 点不动，
 * 也就无法回答"这 31 条是谁练的、练的哪句、对错如何"。指标没有落点，
 * 闭环就是断的。这条链路补齐后，仪表盘 → 练习记录 → 用户详情可以一路点下去。
 *
 * 两个 JOIN：
 *   users     —— 谁练的（练习记录只存 user_id）
 *   sentences —— 练的哪句（只取中文/英文，句子表 46 万行，走主键 JOIN）
 *
 * 两个 JOIN 都用 LEFT：users 理论上不会缺（user_id 非空），但句子可能因为
 * 内容下架被删，INNER JOIN 会把"练过但句子已删"的记录整体吃掉，
 * 导致条数少于仪表盘上的「练习句数」，那种对不上最难排查。
 *
 * 筛选：
 *   range  —— 按练习时间（对应仪表盘的「练习句数」，必须同口径才能对上）
 *   q      —— 用户昵称 / 手机号 / 句子内容
 *   userId —— 从用户详情钻过来看某一个人的练习
 */
export async function GET(request: Request) {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth
  if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })
  const database = db

  const { searchParams } = new URL(request.url)
  const { pageSize, offset } = parsePagination(searchParams)
  const q = (searchParams.get("q") ?? "").trim().slice(0, 64)
  const userId = (searchParams.get("userId") ?? "").trim().slice(0, 36)
  const rangeQuery = parseRangeQuery(searchParams)
  const range = rangeQuery ? resolveRange(rangeQuery) : null
  const from = range?.start ?? null
  // 上界：预设窗口都是"到现在"，只有自定义范围才有终点
  const to = range?.end ?? null

  const conditions: SQL[] = []
  if (from) conditions.push(gte(practiceRecords.createdAt, from))
  if (to) conditions.push(lte(practiceRecords.createdAt, to))
  if (userId) conditions.push(eq(practiceRecords.userId, userId))
  if (q) {
    const matched = or(
      like(users.name, `%${q}%`),
      like(users.phone, `%${q}%`),
      like(sentences.chinese, `%${q}%`),
      like(sentences.english, `%${q}%`),
    )
    if (matched) conditions.push(matched)
  }
  const where: SQL | undefined = conditions.length > 0 ? and(...conditions) : undefined

  const [rows, [{ total }]] = await Promise.all([
    database
      .select({
        id: practiceRecords.id,
        userId: practiceRecords.userId,
        sentenceId: practiceRecords.sentenceId,
        score: practiceRecords.score,
        mistakes: practiceRecords.mistakes,
        isReview: practiceRecords.isReview,
        userInput: practiceRecords.userInput,
        createdAt: practiceRecords.createdAt,
        userName: users.name,
        userPhone: users.phone,
        chinese: sentences.chinese,
        english: sentences.english,
        // 句子可能已被软删除。练习记录是历史事实、不跟着消失（用户当初确实练过），
        // 但界面要能标出"这句已下架"，否则看起来像内容凭空丢了
        sentenceDeletedAt: sentences.deletedAt,
      })
      .from(practiceRecords)
      .leftJoin(users, eq(practiceRecords.userId, users.id))
      .leftJoin(sentences, eq(practiceRecords.sentenceId, sentences.id))
      .where(where)
      .orderBy(desc(practiceRecords.createdAt))
      .limit(pageSize)
      .offset(offset),
    database
      .select({ total: sql<number>`count(*)` })
      .from(practiceRecords)
      .leftJoin(users, eq(practiceRecords.userId, users.id))
      .leftJoin(sentences, eq(practiceRecords.sentenceId, sentences.id))
      .where(where),
  ])

  return NextResponse.json({
    data: rows.map((r) => ({
      ...r,
      userPhone: maskPhone(r.userPhone),
      sentenceDeleted: r.sentenceDeletedAt != null,
    })),
    total: Number(total),
    appliedRange: range,
    appliedRangeLabel: range?.label ?? null,
  })
}
