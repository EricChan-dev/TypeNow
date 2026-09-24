import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth/session"
import { db } from "@/lib/db"
import { practiceSessions } from "@/lib/db/schema"
import { and, eq } from "drizzle-orm"

/**
 * 练习会话的恢复槽位（每课一行）。
 *
 * GET  /api/practice/sessions?lessonId=...  → { session: <row> | null }
 * POST /api/practice/sessions               → { session: <row> }
 *
 * 客户端在进入 / 离开练习页时上报进度，下次进入先 GET 决定恢复到第几句。
 * 恢复决策本身在 lib/practice-session 里（纯函数，有单测）；
 * 这里只负责读写与兜底，不重复实现钳制逻辑。
 */

const PRACTICE_STATES = ["active", "completed", "abandoned"] as const
type PracticeSessionState = (typeof PRACTICE_STATES)[number]

/**
 * 进度类字段一律向 0 收敛，而不是返回 400。
 *
 * 用户此刻正在打字，客户端版本错位（旧包少传/传了字符串）不应该让他丢掉位置；
 * 越界与脏值退化成「从头/已练 0 句」，至少位置是可用的。
 */
function toNonNegativeInt(value: unknown, fallback = 0): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  const truncated = Math.trunc(n)
  return truncated >= 0 ? truncated : fallback
}

function normalizeState(value: unknown): PracticeSessionState {
  return PRACTICE_STATES.includes(value as PracticeSessionState)
    ? (value as PracticeSessionState)
    : "active"
}

export async function GET(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })

    const lessonId = (request.nextUrl.searchParams.get("lessonId") ?? "").trim()
    if (!lessonId) return NextResponse.json({ error: "invalid_lesson_id" }, { status: 400 })

    // GET 只读，绝不顺手建行：否则任何一次进入练习页（哪怕立刻退出）都会产生
    // currentIndex=0 的空会话，之后 decideResume 拿到它只能返回「从头开始」，
    // 用户的真实进度会被这条空记录覆盖掉。
    const [row] = await db
      .select()
      .from(practiceSessions)
      .where(
        and(eq(practiceSessions.userId, session.userId), eq(practiceSessions.lessonId, lessonId))
      )
      .limit(1)

    return NextResponse.json({ session: row ?? null })
  } catch (e) {
    console.error("[practice/sessions GET]", e)
    return NextResponse.json({ error: "server_error" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })

    const body = (await request.json().catch(() => ({}))) as {
      lessonId?: unknown
      courseId?: unknown
      currentIndex?: unknown
      sentenceCount?: unknown
      mistakeCount?: unknown
      elapsedSeconds?: unknown
      state?: unknown
    }

    const lessonId = String(body.lessonId ?? "").trim()
    if (!lessonId) return NextResponse.json({ error: "invalid_lesson_id" }, { status: 400 })

    const courseId = String(body.courseId ?? "").trim()
    if (!courseId) return NextResponse.json({ error: "invalid_course_id" }, { status: 400 })

    const currentIndex = toNonNegativeInt(body.currentIndex, 0)
    const sentenceCount = toNonNegativeInt(body.sentenceCount, 0)
    const mistakeCount = toNonNegativeInt(body.mistakeCount, 0)
    const elapsedSeconds = toNonNegativeInt(body.elapsedSeconds, 0)
    const state = normalizeState(body.state)

    const now = new Date()
    // completed 以外的状态把 completedAt 清空：unique key 决定了重练同一课是
    // 「就地重置」同一行，若保留上次的完成时间，这一行会同时是 active 又带着
    // completed_at，结算/统计读到就自相矛盾。
    const completedAt = state === "completed" ? now : null

    // 复用 (user_id, lesson_id) 唯一键做 upsert：重练不新增行，只重置进度。
    await db
      .insert(practiceSessions)
      .values({
        userId: session.userId,
        courseId,
        lessonId,
        currentIndex,
        state,
        sentenceCount,
        mistakeCount,
        elapsedSeconds,
        updatedAt: now,
        completedAt,
      })
      .onDuplicateKeyUpdate({
        set: {
          courseId,
          currentIndex,
          state,
          sentenceCount,
          mistakeCount,
          elapsedSeconds,
          // updatedAt 每次都推进，它是「上次练习时间」的唯一依据（列表排序也用它）。
          updatedAt: now,
          completedAt,
          // 刻意不覆盖 startedAt：它是本次会话的起点，重复上报进度不应该把它往后挪。
        },
      })

    const [row] = await db
      .select()
      .from(practiceSessions)
      .where(
        and(eq(practiceSessions.userId, session.userId), eq(practiceSessions.lessonId, lessonId))
      )
      .limit(1)

    return NextResponse.json({ session: row ?? null })
  } catch (e) {
    console.error("[practice/sessions POST]", e)
    return NextResponse.json({ error: "server_error" }, { status: 500 })
  }
}
