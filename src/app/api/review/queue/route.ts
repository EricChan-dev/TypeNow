import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { reviewQueue, sentences } from "@/lib/db/schema"
import { and, eq, lte, sql } from "drizzle-orm"
import { getSession } from "@/app/actions/auth"

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })

  const now = new Date()

  const items = await db
    .select({
      reviewId: reviewQueue.id,
      sentenceId: reviewQueue.sentenceId,
      reviewCount: reviewQueue.reviewCount,
      consecutiveOk: reviewQueue.consecutiveOk,
      intervalDays: reviewQueue.intervalDays,
      english: sentences.english,
      chinese: sentences.chinese,
      words: sentences.words,
      chunks: sentences.chunks,
    })
    .from(reviewQueue)
    .innerJoin(sentences, eq(reviewQueue.sentenceId, sentences.id))
    .where(
      and(
        eq(reviewQueue.userId, session.userId),
        eq(reviewQueue.status, "pending"),
        lte(reviewQueue.nextReviewAt, now)
      )
    )
    .orderBy(sql`${reviewQueue.nextReviewAt} ASC`)
    .limit(20)

  // Count total pending (including those not yet due)
  const [{ total }] = await db
    .select({ total: sql<number>`COUNT(*)` })
    .from(reviewQueue)
    .where(
      and(
        eq(reviewQueue.userId, session.userId),
        eq(reviewQueue.status, "pending"),
        lte(reviewQueue.nextReviewAt, now)
      )
    )

  return NextResponse.json({ items, total: Number(total) })
}
