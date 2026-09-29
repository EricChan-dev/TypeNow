import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth/session"
import { db } from "@/lib/db"
import { coinLogs, practiceRecords, users } from "@/lib/db/schema"
import { eq, and, desc, sql } from "drizzle-orm"
import { toShanghaiDateStr } from "@/lib/practice-stats"
import { isProActive } from "@/lib/subscription"
import { COURSE_COMPLETE_REWARD, LESSON_COMPLETE_REWARD } from "@/lib/reward-rules"
import { isCourseRewardEligible, isLessonRewardEligible } from "@/lib/reward-eligibility"
import { sentenceCoinReward } from "@/lib/coins"

/**
 * 练习奖励发放 —— **金币**（免费货币）。
 *
 * 本路由由 /api/diamonds/earn 改造而来（2026-09-29 双货币拆分）。
 * 改造原则是**只换货币与写入目标，判定逻辑一行不动** —— 下面这套服务端权威推导
 * 是本仓库反复强调的资产，曾经修掉过一次真实的刷奖漏洞：
 *
 *   - lesson_complete / course_complete 额度固定，但**必须先通过完成度校验**：
 *     refId 必须是真实存在、已发布的课时 / 课程，且本人确实练完
 *     （见 lib/reward-rules 与 lib/reward-eligibility）。此前这两条都不校验，
 *     而去重键含 refId，于是随机 refId 即可无限领奖 —— 等于没有去重；
 *   - sentence 的 perfect 与连击 streak 全部来自 practice_records。
 *     请求体里的 perfect / streak **一律不采信**（旧实现直接采信，可无限伪造）。
 *
 * 为什么金币可以"敞开给"而钻石不行：金币只能兑换站内的会员天数与道具，
 * 不触碰任何按调用计费的外部服务；钻石才是真金白银（AI / 语音评测）。
 */

const EARN_TYPES = ["sentence", "lesson_complete", "course_complete"] as const
type EarnType = (typeof EARN_TYPES)[number]

/** Perfect 连击的观察窗口，与历史实现保持一致（只用于记录 streak，不再影响额度）。 */
const MAX_PERFECT_BONUS = 20

/**
 * 客户端在同一个 commit 里并发发出三个 fetch（review/enqueue、practice/record、
 * coins/earn）且都不 await，因此「练习记录」可能比「领奖」晚一点落库。
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
    // 注意：金额**不再**与 streak 挂钩（用户决策：每句 +1、完美 +2），
    // 这里仍记录 streak 是因为它是有价值的教学数据（连击展示、错题分析），
    // 且能解释"这一笔为什么标着连击 7"。
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

    // 会员身份决定「练完一节课」的门槛：非会员在 /api/courses/sentences 只能拿到
    // 每课前 FREE_TRIAL_SENTENCES 句，门槛必须按同一口径推导，否则练完也领不到
    // （口径同源见 lib/reward-rules 顶部注释）。
    const [viewer] = await database
      .select({ isPro: users.isPro, proExpires: users.proExpires })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
    const isPro = isProActive(viewer)

    let earned: number
    let streak = 0
    if (type === "lesson_complete") {
      // refId 必须是真实课时，且本人已练完该课的下发句数 —— 两条缺一不可。
      const eligibility = await isLessonRewardEligible(userId, refId, isPro)
      if (!eligibility.ok) {
        return NextResponse.json({ error: eligibility.reason ?? "尚不满足领取条件" }, { status: 403 })
      }
      earned = LESSON_COMPLETE_REWARD
    } else if (type === "course_complete") {
      const eligibility = await isCourseRewardEligible(userId, refId, isPro)
      if (!eligibility.ok) {
        return NextResponse.json({ error: eligibility.reason ?? "尚不满足领取条件" }, { status: 403 })
      }
      earned = COURSE_COMPLETE_REWARD
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
      earned = sentenceCoinReward(perfect)
    }

    // 唯一性约束：同一用户 + 同一奖励类型 + 同一 refId + 同一个上海日历日只能领一次。
    // 先对 users 行加锁，使同一用户的并发领取在数据库层串行化，再查重 + 落库 + 加金币。
    //
    // 这里比旧实现更好的一点：coin_logs 有独立的 `date` 列，所以查重直接等值比较，
    // 不必再对 created_at 套 DATE() —— 后者既用不上索引，又依赖会话时区。
    const claimed = await database.transaction(async (tx) => {
      await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, userId))
        .for("update")

      const [dupe] = await tx
        .select({ id: coinLogs.id })
        .from(coinLogs)
        .where(
          and(
            eq(coinLogs.userId, userId),
            eq(coinLogs.type, type),
            eq(coinLogs.refId, refId),
            eq(coinLogs.date, today),
          ),
        )
        .limit(1)
      if (dupe) return false

      await tx.insert(coinLogs).values({
        userId,
        amount: earned,
        durationSeconds: duration,
        type,
        refId,
        streak,
        date: today,
      })

      await tx
        .update(users)
        .set({ coins: sql`${users.coins} + ${earned}` })
        .where(eq(users.id, userId))

      return true
    })

    const [todayRow] = await database
      .select({
        todayCoins: sql<number>`COALESCE(SUM(${coinLogs.amount}), 0)`,
        todayDuration: sql<number>`COALESCE(SUM(${coinLogs.durationSeconds}), 0)`,
      })
      .from(coinLogs)
      .where(and(eq(coinLogs.userId, userId), eq(coinLogs.date, today)))

    const [userRow] = await database
      .select({ coins: users.coins })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)

    return NextResponse.json({
      earned: claimed ? earned : 0,
      alreadyClaimed: !claimed,
      totalCoins: userRow?.coins ?? 0,
      todayCoins: Number(todayRow?.todayCoins ?? 0),
      todayDurationSeconds: Number(todayRow?.todayDuration ?? 0),
    })
  } catch (e) {
    console.error("[coins/earn]", e)
    return NextResponse.json({ earned: 0 }, { status: 500 })
  }
}
