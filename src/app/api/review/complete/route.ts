import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { reviewQueue } from "@/lib/db/schema"
import { and, eq } from "drizzle-orm"
import { getSession } from "@/app/actions/auth"
import { sm2 } from "@/lib/spaced-repetition"

export async function POST(request: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })

  let body: { sentenceId?: string; grade?: number; mastered?: boolean }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 })
  }

  const { sentenceId, grade, mastered } = body
  if (!sentenceId) {
    return NextResponse.json({ error: "sentenceId required" }, { status: 400 })
  }
  if (!mastered && grade === undefined) {
    return NextResponse.json({ error: "grade or mastered required" }, { status: 400 })
  }
  if (!mastered && grade !== undefined && (grade < 0 || grade > 5)) {
    return NextResponse.json({ error: "grade must be 0-5" }, { status: 400 })
  }

  const [item] = await db
    .select({
      id: reviewQueue.id,
      intervalDays: reviewQueue.intervalDays,
      easeFactor: reviewQueue.easeFactor,
      consecutiveOk: reviewQueue.consecutiveOk,
      reviewCount: reviewQueue.reviewCount,
    })
    .from(reviewQueue)
    .where(
      and(eq(reviewQueue.userId, session.userId), eq(reviewQueue.sentenceId, sentenceId))
    )
    .limit(1)

  if (!item) return NextResponse.json({ error: "Review item not found" }, { status: 404 })

  if (mastered) {
    await db
      .update(reviewQueue)
      .set({ reviewCount: item.reviewCount + 1, status: "done" })
      .where(eq(reviewQueue.id, item.id))
    return NextResponse.json({ success: true, status: "done" })
  }

  const { intervalDays, easeFactor, consecutiveOk } = sm2(
    item.intervalDays,
    parseFloat(String(item.easeFactor)),
    item.consecutiveOk,
    grade!
  )

  const nextReviewAt = new Date(Date.now() + intervalDays * 24 * 60 * 60 * 1000)

  await db
    .update(reviewQueue)
    .set({
      intervalDays,
      easeFactor: String(easeFactor.toFixed(2)),
      consecutiveOk,
      reviewCount: item.reviewCount + 1,
      nextReviewAt,
      status: "pending",
    })
    .where(eq(reviewQueue.id, item.id))

  return NextResponse.json({ success: true, intervalDays, status: "pending", nextReviewAt })
}
