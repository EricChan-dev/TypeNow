// 学习计划概览：计划 + 课程单元列表（每单元 词总数/已学/已掌握/正确率/状态）+ 全局统计。
//
// 词表口径：单元词 = 该课时 sentences.words[].english 规整去重后的有序集合，
// **现算不落库**（见 00034_study_plans.sql「为什么两张表」—— 落一份快照迟早
// 与课程数据漂移）。全部句子一次查回在 JS 里聚合，一门课最多万句量级，
// 概览页不是高频轮询接口，可以接受；以后真慢了再加缓存，不要先加。
import { NextResponse } from "next/server"
import { getSession } from "@/lib/auth/session"
import { db } from "@/lib/db"
import { courses, lessons, sentences, studyPlanWords, studyPlans } from "@/lib/db/schema"
import { and, asc, eq, isNotNull, isNull, lte, sql } from "drizzle-orm"
import { normalizeWordToken } from "@/lib/study-plan"

interface SentenceWordsRow {
  lessonId: string | null
  words: Array<{ english: string }> | null
}

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })

  const [plan] = await db
    .select({ id: studyPlans.id, courseId: studyPlans.courseId, createdAt: studyPlans.createdAt })
    .from(studyPlans)
    .where(eq(studyPlans.userId, session.userId))
    .limit(1)
  if (!plan) return NextResponse.json({ plan: null })

  const [course] = await db
    .select({ title: courses.title })
    .from(courses)
    .where(eq(courses.id, plan.courseId))
    .limit(1)

  const unitRows = await db
    .select({ id: lessons.id, title: lessons.title, sortOrder: lessons.sortOrder })
    .from(lessons)
    .where(and(eq(lessons.courseId, plan.courseId), isNull(lessons.deletedAt)))
    .orderBy(asc(lessons.sortOrder), asc(lessons.id))

  // 一次查回课程全部句子的 words JSON，在 JS 里按课时聚合有序去重词表。
  const sentenceRows = unitRows.length
    ? (await db
        .select({ lessonId: sentences.lessonId, words: sentences.words })
        .from(sentences)
        .innerJoin(lessons, eq(lessons.id, sentences.lessonId))
        .where(and(eq(lessons.courseId, plan.courseId), isNotNull(sentences.words)))
        .orderBy(asc(sentences.sortOrder))) as unknown as SentenceWordsRow[]
    : []

  const unitWords = new Map<string, string[]>()
  const unitSeen = new Map<string, Set<string>>()
  const courseWords = new Set<string>()
  for (const row of sentenceRows) {
    if (!row.lessonId) continue
    let list = unitWords.get(row.lessonId)
    let seen = unitSeen.get(row.lessonId)
    if (!list || !seen) {
      list = []
      seen = new Set()
      unitWords.set(row.lessonId, list)
      unitSeen.set(row.lessonId, seen)
    }
    for (const w of row.words ?? []) {
      const token = normalizeWordToken(w.english ?? "")
      if (!token) continue
      if (!seen.has(token)) {
        seen.add(token)
        list.push(token)
      }
      courseWords.add(token)
    }
  }

  const progressRows = await db
    .select({
      word: studyPlanWords.word,
      lessonId: studyPlanWords.lessonId,
      status: studyPlanWords.status,
      correctCount: studyPlanWords.correctCount,
      wrongCount: studyPlanWords.wrongCount,
    })
    .from(studyPlanWords)
    .where(eq(studyPlanWords.planId, plan.id))

  const [dueRow] = await db
    .select({ due: sql<number>`COUNT(*)` })
    .from(studyPlanWords)
    .where(
      and(
        eq(studyPlanWords.planId, plan.id),
        lte(studyPlanWords.nextReviewAt, new Date())
      )
    )

  const masteredCount = progressRows.filter((r) => r.status === "mastered").length

  const units = unitRows.map((u) => {
    const total = unitWords.get(u.id)?.length ?? 0
    const rows = progressRows.filter((r) => r.lessonId === u.id)
    const touched = rows.length
    const mastered = rows.filter((r) => r.status === "mastered").length
    const correct = rows.reduce((s, r) => s + r.correctCount, 0)
    const wrong = rows.reduce((s, r) => s + r.wrongCount, 0)
    const answered = correct + wrong
    return {
      lessonId: u.id,
      title: u.title,
      sortOrder: u.sortOrder,
      total,
      touched,
      mastered,
      // 正确率没有作答就没有：绝不写 0（0 是一个看起来完全真实的假值）
      accuracy: answered > 0 ? Math.round((correct / answered) * 100) : null,
      status: total === 0 ? ("empty" as const) : touched === 0 ? ("new" as const) : touched >= total ? ("done" as const) : ("learning" as const),
    }
  })

  const due = Number(dueRow?.due ?? 0)

  return NextResponse.json({
    plan: { id: plan.id, courseId: plan.courseId, courseTitle: course?.title ?? "", createdAt: plan.createdAt },
    stats: {
      totalWords: courseWords.size,
      touchedWords: progressRows.length,
      masteredWords: masteredCount,
      dueNow: due,
      unitCount: unitRows.length,
    },
    units,
  })
}
