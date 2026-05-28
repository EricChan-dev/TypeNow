import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { reviewQueue, sentences, lessons, courses } from "@/lib/db/schema"
import { and, eq, lte, sql } from "drizzle-orm"
import { getSession } from "@/app/actions/auth"

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
    .where(whereClause)
    .orderBy(sql`${reviewQueue.nextReviewAt} ASC`)
    .limit(pageSize)
    .offset(offset)

  const [{ total }] = await db
    .select({ total: sql<number>`COUNT(*)` })
    .from(reviewQueue)
    .where(whereClause)

  // Always include due count for badge
  const [{ dueCount }] = await db
    .select({ dueCount: sql<number>`COUNT(*)` })
    .from(reviewQueue)
    .where(and(eq(reviewQueue.userId, session.userId), eq(reviewQueue.status, "pending"), lte(reviewQueue.nextReviewAt, now)))

  const [{ doneCount }] = await db
    .select({ doneCount: sql<number>`COUNT(*)` })
    .from(reviewQueue)
    .where(and(eq(reviewQueue.userId, session.userId), eq(reviewQueue.status, "done")))

  const [{ allCount }] = await db
    .select({ allCount: sql<number>`COUNT(*)` })
    .from(reviewQueue)
    .where(eq(reviewQueue.userId, session.userId))

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
