import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import {
  courses,
  lessons,
  practiceSessions,
  sentences,
  userAcquiredCourses,
  userCourseProgress,
} from "@/lib/db/schema"
import { getSession } from "@/lib/auth/session"
import { aliveCourse, aliveLesson, aliveSentence } from "@/lib/soft-delete"
import { and, eq, inArray, sql } from "drizzle-orm"

/**
 * 「我的课程」专用接口。
 *
 * ── 为什么必须新开一个接口，而不是继续用 /api/courses/list ────────────────────
 *
 * 原先前端调 `/api/courses/list?pageSize=500`，然后**在前端筛**自己学过/获取过的课。
 * 但 list 路由把 pageSize 夹在上限 100（见该文件第 31 行），而生产库有 774 门在架课程
 * 且默认按 created_at 倒序 —— 结果是最新 100 门之外的课程对「我的课程」完全不可见。
 *
 * 实测（2026-09-29）：674/774 门（87%）不可见；user_course_progress 里有 24 行指向
 * 被挡住的课程，涉及 15/26 个用户，其中 13 个真实微信用户。
 *
 * ── 为什么不干脆把 list 的 pageSize 上限提高 ─────────────────────────────────
 *
 * `courses.cover_url` 是 mediumtext，而后台的「上传封面」把图片转成 base64 dataURL
 * 直接写进这一列。一旦有人用后台传几张封面，全量拉取立刻变成 MB 级载荷。
 * 把过滤搬到服务端既是修 bug，也是去掉这个隐患。
 */
export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })

  const [acquired, progress] = await Promise.all([
    db
      .select({ courseId: userAcquiredCourses.courseId })
      .from(userAcquiredCourses)
      .where(eq(userAcquiredCourses.userId, session.userId)),
    db
      .select({
        courseId: userCourseProgress.courseId,
        lastStudiedAt: userCourseProgress.lastStudiedAt,
      })
      .from(userCourseProgress)
      .where(eq(userCourseProgress.userId, session.userId)),
  ])

  // 我的课程 = 已获取 ∪ 已练习过（与原前端逻辑一致，只是搬到了服务端）
  const lastStudied = new Map<string, number>()
  const lastStudiedIso = new Map<string, string>()
  for (const row of progress) {
    const iso = new Date(row.lastStudiedAt).toISOString()
    lastStudied.set(row.courseId, new Date(row.lastStudiedAt).getTime())
    lastStudiedIso.set(row.courseId, iso)
  }
  const ids = [...new Set([...acquired.map((r) => r.courseId), ...lastStudied.keys()])]
  if (ids.length === 0) return NextResponse.json({ data: [] })

  const [rows, lessonCounts, sentenceCounts, completedCounts] = await Promise.all([
    db
      .select()
      .from(courses)
      .where(and(inArray(courses.id, ids), eq(courses.isPublished, 1), aliveCourse)),

    // aliveLesson 不能省：软删除模块顶部写明「所有读这三张表的地方都必须带上
    // 对应的 aliveXxx 谓词」，否则已下架的课时会被算进「N 课」里
    db
      .select({ courseId: lessons.courseId, n: sql<number>`count(*)` })
      .from(lessons)
      .where(and(inArray(lessons.courseId, ids), aliveLesson))
      .groupBy(lessons.courseId),

    // 句子数要经 lessons 关联（课程不直接持有句子），两边都要活体过滤
    db
      .select({ courseId: lessons.courseId, n: sql<number>`count(*)` })
      .from(sentences)
      .innerJoin(lessons, eq(sentences.lessonId, lessons.id))
      .where(and(inArray(lessons.courseId, ids), aliveLesson, aliveSentence))
      .groupBy(lessons.courseId),

    /**
     * 已完成的课时数。
     *
     * 刻意**不用** `user_course_progress.sentenceCount` 算进度百分比 ——
     * 那一列是 GREATEST(...) 维护的单调累计值（重练会持续增长），拿它当分子
     * 会出现 >100% 的进度条。`practice_sessions.state='completed'` 配合
     * UNIQUE(user_id, lesson_id)（保证一课一行）才是精确的「这课练完了」信号。
     *
     * 这里刻意**不做**软删除过滤：用户当初确实练过，内容下架不该改写他的进度历史。
     * （soft-delete 模块顶部把「练习记录等历史统计」明确列为故意不过滤的场景。）
     */
    db
      .select({ courseId: practiceSessions.courseId, n: sql<number>`count(*)` })
      .from(practiceSessions)
      .where(
        and(
          eq(practiceSessions.userId, session.userId),
          eq(practiceSessions.state, "completed"),
          inArray(practiceSessions.courseId, ids),
        ),
      )
      .groupBy(practiceSessions.courseId),
  ])

  const lessonMap = new Map(lessonCounts.map((r) => [r.courseId, Number(r.n)]))
  const sentenceMap = new Map(sentenceCounts.map((r) => [r.courseId, Number(r.n)]))
  const completedMap = new Map(completedCounts.map((r) => [r.courseId, Number(r.n)]))

  const data = rows
    .map((course) => ({
      ...course,
      stats: {
        lessonCount: lessonMap.get(course.id) ?? 0,
        sentenceCount: sentenceMap.get(course.id) ?? 0,
        completedLessons: completedMap.get(course.id) ?? 0,
      },
      /**
       * 上次练习时间，供卡片上的「X 前学过」徽标用。
       * 此前这个徽标由「localStorage + /api/user/progress」两个来源合并而成，
       * 换设备就丢 —— 服务端本来就知道，直接给出来即可。
       * 已获取但从未练习过的课为 null。
       */
      lastStudiedAt: lastStudiedIso.get(course.id) ?? null,
    }))
    .sort((a, b) => (lastStudied.get(b.id) ?? 0) - (lastStudied.get(a.id) ?? 0))

  return NextResponse.json({ data })
}
