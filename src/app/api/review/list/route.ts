import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { reviewQueue, sentences, lessons, courses } from "@/lib/db/schema"
import { and, eq, lte, sql } from "drizzle-orm"
import { getSession } from "@/app/actions/auth"
import { usableSentenceSql } from "@/lib/sentence-quality"

export async function GET(request: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })

  const { searchParams } = new URL(request.url)
  const filter = searchParams.get("status") ?? "due" // "due" | "done" | "all"
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1"))
  const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get("pageSize") ?? "50")))
  const offset = (page - 1) * pageSize

  const now = new Date()

  // 不可用的句子（题干脏：chinese 无中文或与答案雷同；答案脏：english 空串或只有标点）
  // 不进复习本。列表、列表总数、以及三个计数徽标必须全部带上这个条件 ——
  // 只过滤列表不过滤计数，就会出现「徽标有 3 条待复习、点进去是空的」这种自相矛盾。
  const usable = usableSentenceSql(sentences.chinese, sentences.english)

  const whereClause = (() => {
    if (filter === "due") return and(eq(reviewQueue.userId, session.userId), eq(reviewQueue.status, "pending"), lte(reviewQueue.nextReviewAt, now))
    if (filter === "done") return and(eq(reviewQueue.userId, session.userId), eq(reviewQueue.status, "done"))
    return eq(reviewQueue.userId, session.userId)
  })()

  const items = await db
    .select({
      reviewId: reviewQueue.id,
      sentenceId: reviewQueue.sentenceId,
      status: reviewQueue.status,
      intervalDays: reviewQueue.intervalDays,
      consecutiveOk: reviewQueue.consecutiveOk,
      reviewCount: reviewQueue.reviewCount,
      nextReviewAt: reviewQueue.nextReviewAt,
      createdAt: reviewQueue.createdAt,
      english: sentences.english,
      chinese: sentences.chinese,
      courseId: courses.id,
      courseTitle: courses.title,
    })
    .from(reviewQueue)
    .innerJoin(sentences, eq(reviewQueue.sentenceId, sentences.id))
    .leftJoin(lessons, eq(sentences.lessonId, lessons.id))
    .leftJoin(courses, eq(lessons.courseId, courses.id))
    .where(and(whereClause, usable))
    .orderBy(sql`${reviewQueue.nextReviewAt} ASC`)
    .limit(pageSize)
    .offset(offset)

  const [{ total }] = await db
    .select({ total: sql<number>`COUNT(*)` })
    .from(reviewQueue)
    .innerJoin(sentences, eq(reviewQueue.sentenceId, sentences.id))
    .where(and(whereClause, usable))

  // Always include due count for badge
  const [{ dueCount }] = await db
    .select({ dueCount: sql<number>`COUNT(*)` })
    .from(reviewQueue)
    .innerJoin(sentences, eq(reviewQueue.sentenceId, sentences.id))
    .where(and(eq(reviewQueue.userId, session.userId), eq(reviewQueue.status, "pending"), lte(reviewQueue.nextReviewAt, now), usable))

  const [{ doneCount }] = await db
    .select({ doneCount: sql<number>`COUNT(*)` })
    .from(reviewQueue)
    .innerJoin(sentences, eq(reviewQueue.sentenceId, sentences.id))
    .where(and(eq(reviewQueue.userId, session.userId), eq(reviewQueue.status, "done"), usable))

  const [{ allCount }] = await db
    .select({ allCount: sql<number>`COUNT(*)` })
    .from(reviewQueue)
    .innerJoin(sentences, eq(reviewQueue.sentenceId, sentences.id))
    .where(and(eq(reviewQueue.userId, session.userId), usable))

  return NextResponse.json({
    items,
    total: Number(total),
    dueCount: Number(dueCount),
    doneCount: Number(doneCount),
    allCount: Number(allCount),
    page,
    pageSize,
  })
}
