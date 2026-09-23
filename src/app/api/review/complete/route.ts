import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { reviewQueue } from "@/lib/db/schema"
import { and, eq } from "drizzle-orm"
import { getSession } from "@/app/actions/auth"
import { sm2 } from "@/lib/spaced-repetition"
import { parseReviewCompletion } from "@/lib/review-rules"

export async function POST(request: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 })
  }

  // 入参规则统一在 lib/review-rules 里定义（含 mastered/grade 的类型陷阱），
  // 这里只负责把失败结果翻成 HTTP 响应。
  const parsed = parseReviewCompletion(
    (body ?? {}) as { sentenceId?: unknown; grade?: unknown; mastered?: unknown }
  )
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 })
  }
  const { sentenceId, mastered: masteredFlag, grade: gradeNum } = parsed

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

  if (masteredFlag) {
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
    gradeNum!
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
