// 学习计划作答：一次一词，幂等 upsert。
//   首答 → INSERT（interval 1 天起步；答错 interval 0 = 立刻到期）
//   复答 → UPDATE（SM-2 lite，见 src/lib/study-plan.ts）
// 复习模式跨单元作答**不改归属**：lessonId 缺省时沿用已入库行自己的 lessonId。
import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth/session"
import { db } from "@/lib/db"
import { studyPlanWords, studyPlans } from "@/lib/db/schema"
import { and, eq } from "drizzle-orm"
import { applySrsAnswer, normalizeWordToken, type SrsState } from "@/lib/study-plan"
import { isDuplicateKeyError } from "@/lib/db/duplicate-key"

const ZERO_STATE: SrsState = {
  intervalDays: 0,
  easeFactor: 2.5,
  consecutiveOk: 0,
  status: "learning",
}

export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })

  const body = await request.json().catch(() => ({})) as {
    word?: string
    correct?: boolean
    lessonId?: string
  }
  const word = normalizeWordToken(body.word ?? "")
  if (!word) return NextResponse.json({ error: "invalid_word" }, { status: 400 })
  const correct = body.correct === true
  const lessonId = (body.lessonId ?? "").trim() || null

  const [plan] = await db
    .select({ id: studyPlans.id })
    .from(studyPlans)
    .where(eq(studyPlans.userId, session.userId))
    .limit(1)
  if (!plan) return NextResponse.json({ error: "no_plan" }, { status: 404 })

  const [existing] = await db
    .select()
    .from(studyPlanWords)
    .where(and(eq(studyPlanWords.planId, plan.id), eq(studyPlanWords.word, word)))
    .limit(1)

  // 归属：显式带 lessonId 用传入的（首次作答必须带）；没带且已有行 → 沿用原归属。
  const ownerLessonId = lessonId ?? existing?.lessonId ?? null
  if (!ownerLessonId || ownerLessonId.length > 36) {
    return NextResponse.json({ error: "missing_lesson" }, { status: 400 })
  }

  if (!existing) {
    const result = applySrsAnswer(ZERO_STATE, correct)
    try {
      await db.insert(studyPlanWords).values({
        planId: plan.id,
        word,
        lessonId: ownerLessonId,
        reviewCount: 1,
        consecutiveOk: result.consecutiveOk,
        intervalDays: result.intervalDays,
        easeFactor: result.easeFactor.toFixed(2),
        nextReviewAt: result.nextReviewAt,
        correctCount: correct ? 1 : 0,
        wrongCount: correct ? 0 : 1,
        lastAnsweredAt: new Date(),
        status: result.status,
      })
    } catch (err) {
      // 并发首答撞 uk_study_plan_word：按复答路径重算一次（丢一次作答流水可接受，
      // 进度表是「一行最新态」，不是流水账）。drizzle 包装层用 isDuplicateKeyError 看 cause。
      if (isDuplicateKeyError(err)) {
        const [dup] = await db
          .select()
          .from(studyPlanWords)
          .where(and(eq(studyPlanWords.planId, plan.id), eq(studyPlanWords.word, word)))
          .limit(1)
        if (!dup) return NextResponse.json({ error: "insert_conflict" }, { status: 500 })
        const again = applySrsAnswer(
          {
            intervalDays: dup.intervalDays,
            easeFactor: Number(dup.easeFactor),
            consecutiveOk: dup.consecutiveOk,
            status: dup.status,
          },
          correct
        )
        await db
          .update(studyPlanWords)
          .set({
            reviewCount: dup.reviewCount + 1,
            consecutiveOk: again.consecutiveOk,
            intervalDays: again.intervalDays,
            easeFactor: again.easeFactor.toFixed(2),
            nextReviewAt: again.nextReviewAt,
            correctCount: dup.correctCount + (correct ? 1 : 0),
            wrongCount: dup.wrongCount + (correct ? 0 : 1),
            lastAnsweredAt: new Date(),
            status: again.status,
          })
          .where(eq(studyPlanWords.id, dup.id))
        return NextResponse.json({
          ok: true,
          intervalDays: again.intervalDays,
          status: again.status,
          nextReviewAt: again.nextReviewAt,
        })
      }
      throw err
    }
    return NextResponse.json({
      ok: true,
      intervalDays: result.intervalDays,
      status: result.status,
      nextReviewAt: result.nextReviewAt,
    })
  }

  const result = applySrsAnswer(
    {
      intervalDays: existing.intervalDays,
      easeFactor: Number(existing.easeFactor),
      consecutiveOk: existing.consecutiveOk,
      status: existing.status,
    },
    correct
  )
  await db
    .update(studyPlanWords)
    .set({
      reviewCount: existing.reviewCount + 1,
      consecutiveOk: result.consecutiveOk,
      intervalDays: result.intervalDays,
      easeFactor: result.easeFactor.toFixed(2),
      nextReviewAt: result.nextReviewAt,
      correctCount: existing.correctCount + (correct ? 1 : 0),
      wrongCount: existing.wrongCount + (correct ? 0 : 1),
      lastAnsweredAt: new Date(),
      status: result.status,
    })
    .where(eq(studyPlanWords.id, existing.id))

  return NextResponse.json({
    ok: true,
    intervalDays: result.intervalDays,
    status: result.status,
    nextReviewAt: result.nextReviewAt,
  })
}
