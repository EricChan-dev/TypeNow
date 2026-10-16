import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { aliveCourse, aliveLesson, aliveSentence } from "@/lib/soft-delete"
import { reviewQueue, sentences, lessons, courses, wordbookItems } from "@/lib/db/schema"
import { and, desc, eq, sql, type SQL } from "drizzle-orm"
import { getSession } from "@/app/actions/auth"
import { usableSentenceSql } from "@/lib/sentence-quality"
import { parseMistakeSource, type MistakeSource } from "@/lib/mistake-book"

/**
 * 错题本聚合接口：一次 GET 带回客户端首屏要的全部四类数据 ——
 * · courses 课程卡横滑列表（错题口径：只统计错题）
 * · lessons 课节标签（仅当带 courseId 时返回）
 * · stats 复习统计 dueToday/dueTomorrow/mastered/masteryRate
 * · source 三来源计数 mistake/sentence/word
 *
 * 四类数据合并在一个接口里，
 * 初始加载与「删完刷新」各只需一个往返。课程/课节口径跟随 query 参数，
 * 与列表页当前筛选保持一致。
 */

function endOfDay(base: Date, addDays = 0): Date {
  const d = new Date(base)
  d.setDate(d.getDate() + addDays)
  d.setHours(23, 59, 59, 999)
  return d
}

export async function GET(request: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })

  const { searchParams } = new URL(request.url)
  const courseId = searchParams.get("courseId") || null
  const lessonId = searchParams.get("lessonId") || null
  const userId = session.userId

  // 脏句口径与 review/list 一致：所有统计、计数、课程卡都必须带同样的条件，
  // 否则会出现「卡片说有 3 条错题，点进去列表是空的」这种自相矛盾。
  const usable = usableSentenceSql(sentences.chinese, sentences.english)
  const scopeConds = [eq(reviewQueue.userId, userId)]
  if (courseId) scopeConds.push(eq(courses.id, courseId))
  if (lessonId) scopeConds.push(eq(lessons.id, lessonId))
  const scope = and(...scopeConds)

  const now = new Date()
  const endToday = endOfDay(now)
  const endTomorrow = endOfDay(now, 1)

  // ── 课程卡：按课程聚合错题数与待复习数 ────────────────────────────────────
  const courseRows = await db
    .select({
      courseId: courses.id,
      courseName: courses.title,
      coverUrl: courses.coverUrl,
      mistakeCount: sql<number>`COUNT(*)`,
      dueReviewCount: sql<number>`SUM(CASE WHEN ${reviewQueue.status} = 'pending' AND ${reviewQueue.nextReviewAt} <= NOW() THEN 1 ELSE 0 END)`,
    })
    .from(reviewQueue)
    .innerJoin(sentences, eq(reviewQueue.sentenceId, sentences.id))
    .innerJoin(lessons, eq(sentences.lessonId, lessons.id))
    .innerJoin(courses, eq(lessons.courseId, courses.id))
    .where(and(scope, usable, aliveSentence, aliveLesson, aliveCourse))
    .groupBy(courses.id, courses.title, courses.coverUrl)
    .orderBy(desc(sql`COUNT(*)`))
    .limit(50)

  // ── 课节标签：仅选中课程时返回（客户端点课程卡后才需要）──────────────────
  const lessonRows = courseId
    ? await db
        .select({
          lessonId: lessons.id,
          lessonName: lessons.title,
          mistakeCount: sql<number>`COUNT(*)`,
          dueReviewCount: sql<number>`SUM(CASE WHEN ${reviewQueue.status} = 'pending' AND ${reviewQueue.nextReviewAt} <= NOW() THEN 1 ELSE 0 END)`,
        })
        .from(reviewQueue)
        .innerJoin(sentences, eq(reviewQueue.sentenceId, sentences.id))
        .innerJoin(lessons, eq(sentences.lessonId, lessons.id))
        .innerJoin(courses, eq(lessons.courseId, courses.id))
        .where(and(scope, usable, aliveSentence, aliveLesson, aliveCourse))
        .groupBy(lessons.id, lessons.title)
        .orderBy(lessons.sortOrder)
        .limit(200)
    : []

  // scope 里的 courses/lessons 条件只有带筛选时才存在；带筛选时这两个统计查询
  // 必须补上对应 join（否则 SQL 里出现未 join 表的列，MySQL 直接 500），
  // 并与课程卡同口径带上 alive 过滤；无筛选时不加 join —— inner join 会把
  // 没有课节的句子从「全部」口径里静默丢掉。
  const needCourseJoin = Boolean(courseId || lessonId)
  const statWhere = needCourseJoin
    ? and(scope, usable, aliveSentence, aliveLesson, aliveCourse)
    : and(scope, usable, aliveSentence)

  // ── 复习统计：今日待复习/明日/已掌握（带脏句过滤，口径同列表）────────────
  const statBase = db
    .select({
      dueToday: sql<number>`SUM(CASE WHEN ${reviewQueue.status} = 'pending' AND ${reviewQueue.nextReviewAt} <= ${endToday} THEN 1 ELSE 0 END)`,
      dueTomorrow: sql<number>`SUM(CASE WHEN ${reviewQueue.status} = 'pending' AND ${reviewQueue.nextReviewAt} > ${endToday} AND ${reviewQueue.nextReviewAt} <= ${endTomorrow} THEN 1 ELSE 0 END)`,
      mastered: sql<number>`SUM(CASE WHEN ${reviewQueue.status} = 'done' THEN 1 ELSE 0 END)`,
      todayNew: sql<number>`SUM(CASE WHEN ${reviewQueue.createdAt} >= CURDATE() THEN 1 ELSE 0 END)`,
      total: sql<number>`COUNT(*)`,
    })
    .from(reviewQueue)
    .innerJoin(sentences, eq(reviewQueue.sentenceId, sentences.id))
  const [statRow] = await (needCourseJoin
    ? statBase
        .innerJoin(lessons, eq(sentences.lessonId, lessons.id))
        .innerJoin(courses, eq(lessons.courseId, courses.id))
        .where(statWhere)
    : statBase.where(statWhere))

  // ── 三来源计数（供分布条与顶部计数条使用）────────────────────────────────
  // 错题数：当前筛选口径（含脏句过滤），与列表口径一致。
  const mistakeBase = db
    .select({ mistakeCount: sql<number>`COUNT(*)` })
    .from(reviewQueue)
    .innerJoin(sentences, eq(reviewQueue.sentenceId, sentences.id))
  const [mistakeStat] = await (needCourseJoin
    ? mistakeBase
        .innerJoin(lessons, eq(sentences.lessonId, lessons.id))
        .innerJoin(courses, eq(lessons.courseId, courses.id))
        .where(statWhere)
    : mistakeBase.where(statWhere))

  // 收藏句子数：收藏行快照自带 course_id/lesson_id，直接按列过滤（与列表分支一致），
  // 不过滤软删 —— 收藏是个人快照，原句下架后仍算收藏数（展示也走快照）。
  const favConds: (SQL | null)[] = [
    sql`sf.user_id = ${userId}`,
    courseId ? sql`sf.course_id = ${courseId}` : null,
    lessonId ? sql`sf.lesson_id = ${lessonId}` : null,
  ]
  const [favCountRows] = (await db.execute(sql`
    SELECT COUNT(*) AS n FROM sentence_favorites sf
    WHERE ${sql.join(favConds.filter((x): x is SQL => x !== null), sql` AND `)}
  `)) as unknown as [Array<{ n?: number }>]

  // 收藏单词数：词本身与课程无关，仅在带课程/课节筛选时经原句 join 收敛范围。
  const [{ wordCount }] = await db
    .select({ wordCount: sql<number>`COUNT(*)` })
    .from(wordbookItems)
    .where(
      and(
        eq(wordbookItems.userId, userId),
        courseId || lessonId
          ? sql`EXISTS (SELECT 1 FROM sentences ws
                 LEFT JOIN lessons wl ON wl.id = ws.lesson_id
                 LEFT JOIN courses wc ON wc.id = wl.course_id
                 WHERE ws.id = ${wordbookItems.sourceSentenceId} AND ws.deleted_at IS NULL
                   ${courseId ? sql`AND wc.id = ${courseId} AND wc.deleted_at IS NULL` : sql``}
                   ${lessonId ? sql`AND wl.id = ${lessonId} AND wl.deleted_at IS NULL` : sql``})`
          : undefined,
      ),
    )

  const dueToday = Number(statRow?.dueToday ?? 0)
  const dueTomorrow = Number(statRow?.dueTomorrow ?? 0)
  const mastered = Number(statRow?.mastered ?? 0)
  const total = Number(statRow?.total ?? 0)

  return NextResponse.json({
    courses: courseRows.map((r) => ({
      courseId: r.courseId,
      courseName: r.courseName,
      coverUrl: r.coverUrl,
      mistakeCount: Number(r.mistakeCount),
      dueReviewCount: Number(r.dueReviewCount ?? 0),
    })),
    lessons: lessonRows.map((r) => ({
      lessonId: r.lessonId,
      lessonName: r.lessonName,
      mistakeCount: Number(r.mistakeCount),
      dueReviewCount: Number(r.dueReviewCount ?? 0),
    })),
    stats: {
      dueToday,
      dueTomorrow,
      mastered,
      total,
 // todayNew 给真值：当日新入错题本的记录数（createdAt >= CURDATE()）。
      todayNew: Number(statRow?.todayNew ?? 0),
 // masteryRate 是整数百分比；无数据时给 0 而不是 NaN。
      masteryRate: total > 0 ? Math.round((mastered / total) * 100) : 0,
    },
    source: {
      mistake: Number(mistakeStat?.mistakeCount ?? 0),
      sentence: Number(favCountRows?.[0]?.n ?? 0),
      word: Number(wordCount),
    },
  })
}

/**
 * 清空记录（DELETE ?courseId&lessonId&sourceType）。
 *
 * 「清空」清的是**当前筛选范围**：sourceType 决定清哪张表（all = 三张全清），
 * courseId/lessonId 进一步收敛。范围口径与列表分支完全一致 —— 列表里能看到多少，
 * 清空就清多少，绝不扩大（这是对着生产库执行的写操作，宁可少清）。
 */
export async function DELETE(request: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })

  const { searchParams } = new URL(request.url)
  const source: MistakeSource = parseMistakeSource(searchParams.get("sourceType"))
  const courseId = searchParams.get("courseId") || null
  const lessonId = searchParams.get("lessonId") || null
  const userId = session.userId

  const cleared = { mistake: 0, sentence: 0, word: 0 }

  // 与列表口径一致：course/lesson 筛选要求课程/课节未删、句子未删且可用。
  if (source === "mistake" || source === "all") {
    const conds: (SQL | null)[] = [
      sql`rq.user_id = ${userId}`,
      courseId ? sql`c.id = ${courseId} AND c.deleted_at IS NULL` : null,
      lessonId ? sql`l.id = ${lessonId} AND l.deleted_at IS NULL` : null,
    ]
    conds.push(usableSentenceSql(sql`s.chinese`, sql`s.english`))
    const [result] = (await db.execute(sql`
      DELETE rq FROM review_queue rq
      INNER JOIN sentences s ON s.id = rq.sentence_id AND s.deleted_at IS NULL
      LEFT JOIN lessons l ON l.id = s.lesson_id
      LEFT JOIN courses c ON c.id = l.course_id
      WHERE ${sql.join(conds.filter((x): x is SQL => x !== null), sql` AND `)}
    `)) as unknown as [{ affectedRows?: number }]
    cleared.mistake = result?.affectedRows ?? 0
  }

  if (source === "sentence" || source === "all") {
    const conds: (SQL | null)[] = [
      sql`sf.user_id = ${userId}`,
      courseId ? sql`sf.course_id = ${courseId}` : null,
      lessonId ? sql`sf.lesson_id = ${lessonId}` : null,
    ]
    const [result] = (await db.execute(sql`
      DELETE sf FROM sentence_favorites sf
      WHERE ${sql.join(conds.filter((x): x is SQL => x !== null), sql` AND `)}
    `)) as unknown as [{ affectedRows?: number }]
    cleared.sentence = result?.affectedRows ?? 0
  }

  if (source === "word" || source === "all") {
    // 单词表没有课程快照列：带课程/课节范围时经原句 join 收敛（条件与列表分支一致）；
 // 无范围时直接清空该用户全部单词（这正是无筛选语义）。
    const conds: (SQL | null)[] = [
      sql`wb.user_id = ${userId}`,
      courseId ? sql`c.id = ${courseId} AND c.deleted_at IS NULL` : null,
      lessonId ? sql`l.id = ${lessonId} AND l.deleted_at IS NULL` : null,
    ]
    const joinSql =
      courseId || lessonId
        ? sql`LEFT JOIN sentences s ON s.id = wb.source_sentence_id AND s.deleted_at IS NULL
              LEFT JOIN lessons l ON l.id = s.lesson_id
              LEFT JOIN courses c ON c.id = l.course_id`
        : sql``
    const [result] = (await db.execute(sql`
      DELETE wb FROM wordbook_items wb ${joinSql}
      WHERE ${sql.join(conds.filter((x): x is SQL => x !== null), sql` AND `)}
    `)) as unknown as [{ affectedRows?: number }]
    cleared.word = result?.affectedRows ?? 0
  }

  return NextResponse.json({ success: true, cleared })
}
