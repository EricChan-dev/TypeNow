import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { reviewQueue } from "@/lib/db/schema"
import { and, eq } from "drizzle-orm"
import { getSession } from "@/app/actions/auth"

// Simplified SM-2
function sm2(
  intervalDays: number,
  easeFactor: number,
  consecutiveOk: number,
  grade: number
): { intervalDays: number; easeFactor: number; consecutiveOk: number; status: string } {
  let newInterval = intervalDays
  let newEase = easeFactor
  let newConsec = consecutiveOk

  if (grade <= 2) {
    newInterval = 1
    newConsec = 0
  } else if (grade === 3) {
    newInterval = Math.ceil(intervalDays * 1.2)
    newConsec = Math.max(0, consecutiveOk - 1)
  } else if (grade === 4) {
    newInterval = Math.ceil(intervalDays * easeFactor)
    newConsec = consecutiveOk + 1
  } else {
    newInterval = Math.min(30, Math.ceil(intervalDays * easeFactor * 1.15))
    newEase = Math.min(3.0, easeFactor + 0.1)
    newConsec = consecutiveOk + 1
  }

  const status = newInterval >= 14 && grade >= 4 ? "done" : "pending"
  return { intervalDays: newInterval, easeFactor: newEase, consecutiveOk: newConsec, status }
}

export async function POST(request: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })

  let body: { sentenceId?: string; grade?: number }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 })
  }

  const { sentenceId, grade } = body
  if (!sentenceId || grade === undefined) {
    return NextResponse.json({ error: "sentenceId and grade required" }, { status: 400 })
  }
  if (grade < 0 || grade > 5) {
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

  const { intervalDays, easeFactor, consecutiveOk, status } = sm2(
    item.intervalDays,
    parseFloat(String(item.easeFactor)),
    item.consecutiveOk,
    grade
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
      status,
    })
    .where(eq(reviewQueue.id, item.id))

  return NextResponse.json({ success: true, intervalDays, status, nextReviewAt })
}
