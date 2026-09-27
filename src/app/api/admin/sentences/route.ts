import { randomUUID } from "crypto"
import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { aliveSentence, deletedSentence } from "@/lib/soft-delete"
import { deletedCondition, deletedScope } from "@/lib/soft-delete-view"
import { sentences } from "@/lib/db/schema"
import { requireAdmin } from "@/lib/admin-auth"
import { logAdminAction, sentenceAuditLabel } from "@/lib/admin-audit"
import { parsePagination } from "@/lib/pagination"
import { getCachedCount, invalidateCachedCount, STATS_KEYS } from "@/lib/stats-cache"
import { eq, like, or, and, sql, asc, desc, type SQL } from "drizzle-orm"

/**
 * 后台「句子管理」列表。
 *
 * 这个接口原来的排序语义是**错的**，不只是慢：
 *
 *   `ORDER BY sort_order, created_at` 里的 sort_order 是**课内顺序**，
 *   不是全局序号（全表范围 0..960，单课最多 960 句、平均 27.3 句）。
 *   全局按它排，等于把 16,891 个课时的"第 0 句"堆在一起 ——
 *   实测 `ORDER BY sort_order LIMIT 10` 取到的 10 行来自 **10 个不同课时**。
 *   也就是说原来的列表哪怕不慢，也读不出"这是哪一课的第几句"。
 *
 * 现在的规则：
 *   - **给了 lessonId** → 课内顺序 `sort_order ASC`（这时它才有意义），
 *     走 idx_sentences_lesson_sort，单课平均 27 行；total 精确且便宜。
 *   - **没给 lessonId** → `created_at DESC`（"最近添加"，唯一在全局意义上
 *     有效的顺序），走 idx_sentences_created_at，不再全表 filesort；
 *     total 复用 stats-cache 的全局总数（与仪表盘「句子库」同一个数、同一份缓存）。
 *
 * 搜索（`q`）**必须带课时范围**：
 *   `chinese LIKE '%词%'` 是前导通配符，B-tree 索引用不上。带 lessonId 时只扫
 *   那一课的几十行；不带时要在 46 万行 / 2.9GB 上全表扫（实测 1.3s 起，
 *   生僻词或冷缓存会到 25s 以上，还会把这台共享机器的 I/O 打满）。
 *   所以这里直接拒绝并说明原因，而不是让人对着转圈等 25 秒 ——
 *   真正的全库模糊搜索需要 FULLTEXT + ngram 分词，那是另一次改动
 *   （见 db/migrations/00015 的说明）。
 *
 * 写操作会失效总数缓存：否则列表与仪表盘上的总数在 10 分钟 TTL 内不含
 * 刚加的这一句，看起来像"保存没生效"。
 */
export async function GET(request: Request) {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth
  if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })
  const database = db

  const { searchParams } = new URL(request.url)
  const { pageSize, offset } = parsePagination(searchParams)
  // 通用搜索词：中英文都搜。
  // 原先这里把 chinese / english 两个参数读进同一个变量，却**只**搜 chinese ——
  // 于是 ?english=xxx 会静默去搜中文列，返回一堆无关结果。已修正为两者都搜。
  const search = (
    searchParams.get("q") ??
    searchParams.get("chinese") ??
    searchParams.get("english") ??
    ""
  ).trim()
  const lessonId = (searchParams.get("lessonId") ?? "").trim()

  if (search && !lessonId) {
    return NextResponse.json(
      {
        error:
          "全库搜索会扫描 46 万行句子（实测 1.3~25 秒），请先选择题库中的课时再搜索。",
        code: "scope_required",
      },
      { status: 400 },
    )
  }

  const view = deletedScope(searchParams.get("deleted"))
  const conditions: SQL[] = [deletedCondition(view, aliveSentence, deletedSentence)]
  if (lessonId) conditions.push(eq(sentences.lessonId, lessonId))
  if (search) {
    const matched = or(
      like(sentences.chinese, `%${search}%`),
      like(sentences.english, `%${search}%`),
    )
    if (matched) conditions.push(matched)
  }
  const where = and(...conditions)

  // 有课时范围时按课内顺序（有意义且走索引），否则按最近添加。
  // 第二个排序键是**稳定分页**所必需的：同一秒内批量导入的句子 created_at 完全相同，
  // 只按它排序时 MySQL 不保证翻页顺序一致，第 2 页会出现第 1 页已经看过的行
  // （埋点列表踩过同一个坑）。
  const orderBy = lessonId
    ? [asc(sentences.sortOrder), asc(sentences.createdAt), asc(sentences.id)]
    : [desc(sentences.createdAt), desc(sentences.id)]

  const rows = await database
    .select()
    .from(sentences)
    .where(where)
    .limit(pageSize)
    .offset(offset)
    .orderBy(...orderBy)

  // total：有课时范围时精确计数（单课最多 960 行，走复合索引），
  // 没有范围时就是全表总数，直接复用缓存
  let total: number
  // 只有"正常视图 + 无任何筛选"时，全表未删除总数才等于这个列表的 total，
  // 那时可以复用缓存；其余情况（课内、回收站、搜索）都必须精确计数。
  // 缓存条件是 view === "normal" 而不是别的：回收站里的 total 显然不是全局总数。
  if (lessonId || view !== "normal" || search) {
    const [row] = await database
      .select({ total: sql<number>`count(*)` })
      .from(sentences)
      .where(where)
    total = Number(row?.total ?? 0)
  } else {
    const cached = await getCachedCount(STATS_KEYS.totalSentences, async () => {
      const [row] = await database
        .select({ total: sql<number>`count(*)` })
        .from(sentences)
        // 必须与仪表盘「句子库」算的是同一个数（未删除总数）：
        // 两者共用 stats.total_sentences 这个 key，口径不一致会互相覆盖缓存
        .where(aliveSentence)
      return Number(row?.total ?? 0)
    })
    if (cached === null) {
      // 缓存不可用时退回真实计数：列表要翻页，total 不能是 null
      const [row] = await database.select({ total: sql<number>`count(*)` }).from(sentences)
      total = Number(row?.total ?? 0)
    } else {
      total = cached
    }
  }

  return NextResponse.json({
    data: rows,
    total,
    // 回显排序口径，页面据此决定列含义（课内顺序 vs 添加时间）
    orderedBy: lessonId ? "sortOrder" : "createdAt",
    totalIsCached: !(lessonId || view !== "normal" || search),
  })
}

export async function POST(request: Request) {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth
  if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })

  const body = await request.json()
  const { chinese, english, wordsCount, category, difficulty, tags, lessonId, words, chunks, sortOrder, dependencyAnalysis } = body
  const id = randomUUID()
  await db.insert(sentences).values({ id, chinese, english, wordsCount, category, difficulty, tags, lessonId, words, chunks, sortOrder, dependencyAnalysis })
  // 立刻失效总数缓存，否则新句子在 TTL 内不计入列表/仪表盘的总数
  await invalidateCachedCount(STATS_KEYS.totalSentences)
  const [row] = await db.select().from(sentences).where(eq(sentences.id, id)).limit(1)
  // 审计写在 invalidateCachedCount 之后：两者都是旁路，但缓存失效是业务的一部分，
  // 不能被审计的任何问题连累（logAdminAction 本身不抛，这里只是顺序上分清主次）
  await logAdminAction(auth, {
    action: "create",
    targetType: "sentence",
    targetId: id,
    targetLabel: sentenceAuditLabel(chinese),
    detail: { chinese, english, lessonId, sortOrder },
  }, request)
  return NextResponse.json({ data: row }, { status: 201 })
}
