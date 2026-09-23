import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { reviewQueue } from "@/lib/db/schema"
import { and, eq } from "drizzle-orm"
import { getSession } from "@/app/actions/auth"

export async function POST(request: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })

  let body: { sentenceId?: string; forceReset?: boolean }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 })
  }

  const { sentenceId, forceReset } = body
  if (!sentenceId) return NextResponse.json({ error: "sentenceId required" }, { status: 400 })

  const userId = session.userId
  const nextReviewAt = new Date() // immediately available for review

  // Check if already in queue
  const [existing] = await db
    .select({ id: reviewQueue.id, status: reviewQueue.status })
    .from(reviewQueue)
    .where(and(eq(reviewQueue.userId, userId), eq(reviewQueue.sentenceId, sentenceId)))
    .limit(1)

  if (existing) {
    // 已掌握（graduated）重新加入，或调用方显式要求 forceReset（复习本的「再练
    // 一次」按钮）都要立刻拉回今日。此前 forceReset 被直接忽略：调用方以为已经
    // 重置成功（接口返回 200），但队列里的到期日仍留在未来，按钮点了没反应。
    if (existing.status === "done" || forceReset === true) {
      await db
        .update(reviewQueue)
        .set({ status: "pending", nextReviewAt, intervalDays: 1, consecutiveOk: 0 })
        .where(eq(reviewQueue.id, existing.id))
      return NextResponse.json({ success: true, alreadyQueued: true, reset: true })
    }
    // If pending, leave as is
    return NextResponse.json({ success: true, alreadyQueued: true })
  }

  await db.insert(reviewQueue).values({
    userId,
    sentenceId,
    status: "pending",
    nextReviewAt,
    intervalDays: 1,
    easeFactor: "2.50",
  })

  return NextResponse.json({ success: true })
}
