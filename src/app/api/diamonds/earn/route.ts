import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth/session"
import { db } from "@/lib/db"
import { diamondLogs, practiceRecords, users } from "@/lib/db/schema"
import { eq, and, desc, sql } from "drizzle-orm"
import { toShanghaiDateStr } from "@/lib/practice-stats"

const EARN_TYPES = ["sentence", "lesson_complete", "course_complete"] as const
type EarnType = (typeof EARN_TYPES)[number]

/** Perfect 连击奖励上限，与历史 calcEarned 保持一致。 */
const MAX_PERFECT_BONUS = 20
/** practice_records 的迟到重试窗口：客户端先发 /api/practice/record，两个请求并发时记录可能晚一步。 */
/**
 * 客户端在同一个 commit 里并发发出三个 fetch（review/enqueue、practice/record、
 * diamonds/earn）且都不 await，因此「练习记录」可能比「领奖」晚一点落库。
 * 这里按固定间隔重试若干次来覆盖该竞态：既避免真实用户漏发奖励，
 * 又不会变成「一直等到记录出现」而被用来凭空领奖（总等待上限约 0.8 秒）。
 */
const PRACTICE_RECORD_RETRY_MS = 200
const PRACTICE_RECORD_MAX_ATTEMPTS = 5
/** durationSeconds 只是统计字段，服务端做一次合理上限裁剪，避免被写入异常大值。 */
const MAX_DURATION_SECONDS = 24 * 60 * 60

function isEarnType(value: unknown): value is EarnType {
  return typeof value === "string" && (EARN_TYPES as readonly string[]).includes(value)
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * 奖励完全由服务端权威数据推导：
 *   - lesson_complete / course_complete 是固定额度；
 *   - sentence 的 perfect 与连击 streak 全部来自 practice_records。
 * 请求体里的 perfect / streak 一律不采信（旧实现直接采信，可无限伪造）。
 */
function sentenceReward(perfect: boolean, streak: number): number {
  if (!perfect) return 5
  if (streak <= 1) return 5
  return 5 + Math.min(streak, MAX_PERFECT_BONUS)
}

function normalizeDuration(value: unknown): number | null {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.min(Math.trunc(n), MAX_DURATION_SECONDS)
}

export async function POST(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })
    const database = db

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let body: any
    try { body = await request.json() } catch { return NextResponse.json({ error: "请求格式错误" }, { status: 400 }) }

    const { type, refId, durationSeconds }: {
      type?: unknown
      refId?: unknown
      durationSeconds?: unknown
    } = body ?? {}

    if (!isEarnType(type)) {
      return NextResponse.json({ error: "Invalid type" }, { status: 400 })
    }
    if (typeof refId !== "string" || !refId) {
      return NextResponse.json({ error: "缺少 refId" }, { status: 400 })
    }

    const userId = session.userId
    const today = toShanghaiDateStr()
    const duration = normalizeDuration(durationSeconds)

    const loadAttempt = async () => {
      const [row] = await database
        .select({ mistakes: practiceRecords.mistakes })
        .from(practiceRecords)
        .where(and(eq(practiceRecords.userId, userId), eq(practiceRecords.sentenceId, refId)))
        .orderBy(desc(practiceRecords.createdAt))
        .limit(1)
      return row
    }

    // 连续满分次数从最近的练习记录序列推导，而不是客户端传入的 streak。
    const loadPerfectStreak = async (): Promise<number> => {
      const recent = await database
        .select({ sentenceId: practiceRecords.sentenceId, mistakes: practiceRecords.mistakes })
        .from(practiceRecords)
        .where(eq(practiceRecords.userId, userId))
        .orderBy(desc(practiceRecords.createdAt))
        .limit(MAX_PERFECT_BONUS + 1)
      if (recent[0]?.sentenceId !== refId || recent[0].mistakes !== 0) return 1
      let streak = 0
      for (const row of recent) {
        if (row.mistakes === 0) streak++
        else break
      }
      return Math.max(1, streak)
    }

    let earned: number
    let streak = 0
    if (type === "lesson_complete") {
      earned = 30
    } else if (type === "course_complete") {
      earned = 100
    } else {
      // sentence：必须存在本人对该句的真实练习记录才发放奖励。
      let attempt = await loadAttempt()
      for (let i = 1; !attempt && i < PRACTICE_RECORD_MAX_ATTEMPTS; i++) {
        await sleep(PRACTICE_RECORD_RETRY_MS)
        attempt = await loadAttempt()
      }
      if (!attempt) {
        return NextResponse.json({ error: "未找到练习记录，无法发放奖励" }, { status: 403 })
      }
      const perfect = attempt.mistakes === 0
      streak = perfect ? await loadPerfectStreak() : 0
      earned = sentenceReward(perfect, streak)
    }

    // 唯一性约束：同一用户 + 同一奖励类型 + 同一 refId + 同一个上海日历日只能领一次。
    // 先对 users 行加锁，使同一用户的并发领取在数据库层串行化，再查重 + 落库 + 加钻石。
    const claimed = await database.transaction(async (tx) => {
      await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, userId))
        .for("update")

      const [dupe] = await tx
        .select({ id: diamondLogs.id })
        .from(diamondLogs)
        .where(
          and(
            eq(diamondLogs.userId, userId),
            eq(diamondLogs.type, type),
            eq(diamondLogs.refId, refId),
            sql`DATE(${diamondLogs.createdAt}) = ${today}`,
          ),
        )
        .limit(1)
      if (dupe) return false

      await tx.insert(diamondLogs).values({
        userId,
        amount: earned,
        durationSeconds: duration,
        type,
        refId,
        streak,
      })

      await tx
        .update(users)
        .set({ diamonds: sql`${users.diamonds} + ${earned}` })
        .where(eq(users.id, userId))

      return true
    })

    const [todayRow] = await database
      .select({
        todayDiamonds: sql<number>`COALESCE(SUM(${diamondLogs.amount}), 0)`,
        todayDuration: sql<number>`COALESCE(SUM(${diamondLogs.durationSeconds}), 0)`,
      })
      .from(diamondLogs)
      .where(
        and(
          eq(diamondLogs.userId, userId),
          sql`DATE(${diamondLogs.createdAt}) = ${today}`
        )
      )

    const [userRow] = await database
      .select({ diamonds: users.diamonds })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)

    return NextResponse.json({
      earned: claimed ? earned : 0,
      alreadyClaimed: !claimed,
      totalDiamonds: userRow?.diamonds ?? 0,
      todayDiamonds: Number(todayRow?.todayDiamonds ?? 0),
      todayDurationSeconds: Number(todayRow?.todayDuration ?? 0),
    })
  } catch (e) {
    console.error("[diamonds/earn]", e)
    return NextResponse.json({ earned: 0 }, { status: 500 })
  }
}
