import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import {
  courses,
  lessons,
  practiceSessions,
  sentences,
  userAcquiredCourses,
  userCourseProgress,
  users,
} from "@/lib/db/schema"
import { and, asc, eq, inArray, sql } from "drizzle-orm"
import { getSession } from "@/lib/auth/session"
import { checkAndExpirePro } from "@/lib/subscription"
import { aliveCourse, aliveLesson, aliveSentence } from "@/lib/soft-delete"

/**
 * 课程详情页（/home/courses/[courseId]）的数据接口。
 *
 * ── 为什么不是复用 /api/courses/[id] + /[id]/lessons ─────────────────────────
 *
 * 详情页一屏要拼 5 份数据：课程行、课节列表（含每课句子数）、当前用户的
 * 每课练习状态、课程级学习统计、会员/获取态。逐个调现有接口是 4 次往返
 * 且拿不到「按课节分组的会话状态」。这里一次拼好，口径全部写在服务端。
 *
 * ── 锁定模型：刻意不搬基准实现的课节级付费墙 ──────────────────────────────────
 *
 * 基准实现对免费用户把第 2 节起标成 pay-locked（按钮「开通解锁」弹升级框）。
 * 但我们的真实模型是**每节课都能进，非会员每课前 5 句试学**
 * （lib/free-trial.ts，sliceForTrial 在 /api/courses/sentences 截断）。
 * 照搬课节锁等于虚假宣传——按钮承诺解锁的东西并不存在。
 * 因此本接口不下发任何 locked 字段；课程级的会员引导由前端根据
 * viewer.isPro 渲染，文案说真话（「开通会员，解锁全部句子」）。
 *
 * ── 统计口径（学习统计 4 卡）────────────────────────────────────────────────
 *
 * · practiceCount   = 该课程下 practice_sessions 的行数。注意每行是一个
 *   (lesson × mode) 槽位（uk_practice_session 唯一键，重练同一槽位是就地
 *   upsert 不新增行），所以这是「练过多少个课节×模式」，不是「点过多少次
 *   开始练习」。我们没有记录重复练习次数，不发明数据。
 * · completedSentences = user_course_progress.sentence_count，课程级单调
 *   累计的历史句数（GREATEST 更新，见该表注释）。
 * · mistakeCount    = Σ sessions.mistake_count（每个槽位最近一次练习的错数）。
 * · elapsedSeconds  = Σ sessions.elapsed_seconds，同上口径。
 */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: "请先登录" }, { status: 401 })
    if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })

    const { id } = await params
    const [course] = await db
      .select()
      .from(courses)
      .where(and(eq(courses.id, id), eq(courses.isPublished, 1), aliveCourse))
      .limit(1)
    if (!course) return NextResponse.json({ error: "Not found" }, { status: 404 })

    const [lessonRows, revoked, viewerRow, acquiredRow, progressRow] = await Promise.all([
      db
        .select({
          id: lessons.id,
          title: lessons.title,
          summary: lessons.summary,
          sortOrder: lessons.sortOrder,
        })
        .from(lessons)
        .where(and(eq(lessons.courseId, id), aliveLesson))
        .orderBy(asc(lessons.sortOrder)),

      // 会员态：与 /api/courses/sentences 同一套（先过期结算再读）
      checkAndExpirePro(session.userId),
      db
        .select({ isPro: users.isPro, trialClaimedAt: users.trialClaimedAt })
        .from(users)
        .where(eq(users.id, session.userId))
        .limit(1),
      db
        .select({ id: userAcquiredCourses.id })
        .from(userAcquiredCourses)
        .where(
          and(
            eq(userAcquiredCourses.userId, session.userId),
            eq(userAcquiredCourses.courseId, id),
          ),
        )
        .limit(1),
      db
        .select({ sentenceCount: userCourseProgress.sentenceCount })
        .from(userCourseProgress)
        .where(
          and(eq(userCourseProgress.userId, session.userId), eq(userCourseProgress.courseId, id)),
        )
        .limit(1),
    ])

    // drizzle 的 select().limit(1) 返回数组——取 [0] 而不是把数组当对象
    const viewer = viewerRow[0]
    const isPro = revoked ? false : !!viewer?.isPro
    const trialAvailable = !isPro && viewer?.trialClaimedAt == null

    const lessonIds = lessonRows.map((l) => l.id)

    // 句子数与练习会话都只在「有课节」时才值得查
    const [sentenceCounts, sessionRows] = lessonIds.length
      ? await Promise.all([
          // 与 /api/courses/mine 同口径：只过滤软删除，不做「可用句」质量过滤
          //（卡片和详情页显示同一个数，进练习页才按质量筛）
          db
            .select({ lessonId: sentences.lessonId, n: sql<number>`count(*)` })
            .from(sentences)
            .where(and(inArray(sentences.lessonId, lessonIds), aliveSentence))
            .groupBy(sentences.lessonId),
          db
            .select({
              lessonId: practiceSessions.lessonId,
              state: practiceSessions.state,
              currentIndex: practiceSessions.currentIndex,
              mistakeCount: practiceSessions.mistakeCount,
              elapsedSeconds: practiceSessions.elapsedSeconds,
              updatedAt: practiceSessions.updatedAt,
            })
            .from(practiceSessions)
            .where(
              and(
                eq(practiceSessions.userId, session.userId),
                eq(practiceSessions.courseId, id),
              ),
            ),
        ])
      : [[], []]

    const countByLesson = new Map<string, number>()
    for (const r of sentenceCounts) {
      if (r.lessonId) countByLesson.set(r.lessonId, Number(r.n))
    }

 // 课节状态派生（与基准实现三态对齐：completed / current / none）：
    // · completed —— 任一模式练完（state='completed'）
    // · current   —— 有 active 槽位且推进过（currentIndex>0），「继续练习」
    // · none      —— 没碰过或刚开过头
    // lastPracticedAt 取该课所有槽位里最新的 updatedAt（「最近练习」标签）。
    type LessonAgg = {
      completed: boolean
      current: boolean
      lastPracticedAt: number
    }
    const aggByLesson = new Map<string, LessonAgg>()
    let practiceCount = 0
    let mistakeCount = 0
    let elapsedSeconds = 0
    for (const s of sessionRows) {
      practiceCount += 1
      mistakeCount += Number(s.mistakeCount ?? 0)
      elapsedSeconds += Number(s.elapsedSeconds ?? 0)
      const t = new Date(s.updatedAt).getTime()
      const agg = aggByLesson.get(s.lessonId) ?? {
        completed: false,
        current: false,
        lastPracticedAt: 0,
      }
      if (s.state === "completed") agg.completed = true
      else if (s.state === "active" && Number(s.currentIndex ?? 0) > 0) agg.current = true
      if (Number.isFinite(t) && t > agg.lastPracticedAt) agg.lastPracticedAt = t
      aggByLesson.set(s.lessonId, agg)
    }

    const lessonsOut = lessonRows.map((l) => {
      const agg = aggByLesson.get(l.id)
      const state = agg?.completed ? "completed" : agg?.current ? "current" : "none"
      return {
        id: l.id,
        title: l.title,
        summary: l.summary,
        sortOrder: l.sortOrder,
        sentenceCount: countByLesson.get(l.id) ?? 0,
        state: state as "completed" | "current" | "none",
        lastPracticedAt: agg?.lastPracticedAt
          ? new Date(agg.lastPracticedAt).toISOString()
          : null,
      }
    })

    // 完成课节数 = 有 completed 会话的 distinct lesson（与 /api/courses/mine
    // 的 count(distinct lesson_id) 口径一致；同一课多模式各占一行，不能数行）
    const completedLessons = lessonsOut.filter((l) => l.state === "completed").length
    const totalLessons = lessonsOut.length

    return NextResponse.json({
      course: {
        id: course.id,
        title: course.title,
        description: course.description,
        coverUrl: course.coverUrl,
        learnerCount: course.learnerCount,
        categoryKey: course.categoryKey,
        subCategoryKey: course.subCategoryKey,
        textbookVersion: course.textbookVersion,
      },
      stats: {
        practiceCount,
        completedSentences: Number(progressRow[0]?.sentenceCount ?? 0),
        mistakeCount,
        elapsedSeconds,
      },
      progress: {
        completedLessons,
        totalLessons,
        percent: totalLessons ? Math.round((completedLessons / totalLessons) * 100) : 0,
      },
      viewer: {
        isPro,
        trialAvailable,
        // 注意不能写 !!acquiredRow——空数组也是 truthy，会把没获取过判成获取过
        acquired: acquiredRow.length > 0,
      },
      lessons: lessonsOut,
    })
  } catch (e) {
    console.error("[courses/[id]/detail GET]", e)
    return NextResponse.json({ error: "server_error" }, { status: 500 })
  }
}
