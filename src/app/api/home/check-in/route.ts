import { NextResponse } from "next/server"
import { getSession } from "@/lib/auth/session"
import { db } from "@/lib/db"
import { checkIns, coinLogs, practiceRecords, users } from "@/lib/db/schema"
import { eq, and, desc, sql } from "drizzle-orm"
import { computeStreak, toShanghaiDateStr } from "@/lib/practice-stats"
import {
  CHECK_IN_GOAL_DEFAULT,
  checkInCoinReward,
  clampCheckInGoal,
  sentencesToCheckIn,
} from "@/lib/coins"

/**
 * 每日打卡：校验门槛 + 发放**金币**奖励。
 *
 * ── 门槛语义（2026-09-29 变更，改这块之前务必先读）─────────────────────────
 *
 * 门槛从「当日获得钻石数 ≥ check_in_goal」改为「**当日练习句数** ≥ check_in_goal」。
 *
 * 这不只是口径调整 —— 不改它打卡会**彻底坏掉**：本次把练习奖励改为发金币后，
 * diamond_logs 不再新增，旧判定读到的当日钻石恒为 0，于是门槛永远不满足，
 * 而且只是静默返回 403、没有任何报错，非常难发现。
 *
 * 新口径对齐句乐部官方文档（julebu.co/docs/guide-tasks-coins 原文）：
 *   「每日打卡：完成当天的打卡目标就算完成（打卡目标可以自己设，默认 10 个练习点）」
 *
 * 为什么门槛用**学习量**而不是货币量：
 *   1. 若门槛判「当日获得金币」，而打卡奖励本身就发金币，会形成
 *      「打卡奖励依赖打卡是否成立」的循环；
 *   2. 句数无法用登录、刷新之类的零成本动作绕过。
 *
 * 去重到句子（COUNT DISTINCT）是刻意的：同一句反复练不该把门槛刷过去，
 * 门槛要的是「今天真的学了东西」。
 *
 * ── 奖励 ────────────────────────────────────────────────────────────────────
 *
 * 首次打卡发金币（checkInCoinReward：+10 起，按连续天数每日 +2，封顶 +30）。
 * 幂等由 check_ins 既有的唯一键 (user_id, date) 保证 —— 用 INSERT IGNORE 的
 * affectedRows 判断「今天是不是第一次」，只在成功那一支发奖励。
 * 先 SELECT 再 INSERT 是不行的：并发双击会各自查到"没打过"、各发一份。
 */
export async function POST() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })

  const today = toShanghaiDateStr()
  const userId = session.userId
  // 收窄一次到局部常量：下面的 readStreak / alreadyDone 是闭包，
  // 直接用 database 会让 TS 丢掉非空收窄（本仓库其它路由同样如此处理）。
  const database = db

  const [userRow] = await database
    .select({ checkInGoal: users.checkInGoal })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  const checkInGoal = clampCheckInGoal(userRow?.checkInGoal ?? CHECK_IN_GOAL_DEFAULT)

  const [todayRow] = await database
    .select({ cnt: sql<number>`COUNT(DISTINCT ${practiceRecords.sentenceId})` })
    .from(practiceRecords)
    .where(
      and(
        eq(practiceRecords.userId, userId),
        sql`DATE(${practiceRecords.createdAt}) = ${today}`
      )
    )
  const todaySentences = Number(todayRow?.cnt ?? 0)

  /**
   * 读连续天数。
   *
   * **必须在写入今天的 check_in 之后调用** —— computeStreak 在「今天不在列表里」
   * 时会从昨天起算，先调用会少算一天，连击奖励跟着少发。
   */
  const readStreak = async () => {
    const rows = await database
      .select({ date: checkIns.date })
      .from(checkIns)
      .where(eq(checkIns.userId, userId))
      .orderBy(desc(checkIns.date))
      .limit(400)
    return computeStreak(rows.map((r) => r.date), today)
  }

  /** 已打卡（或并发抢占失败）时的成功响应：不再发奖励，但把状态如实回给前端。 */
  const alreadyDone = async () => {
    const [coinRow] = await database
      .select({ coins: users.coins })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
    return NextResponse.json({
      success: true,
      alreadyCheckedIn: true,
      coinsEarned: 0,
      streakDays: await readStreak(),
      totalCoins: coinRow?.coins ?? 0,
      todaySentences,
      checkInGoal,
    })
  }

  const [existing] = await database
    .select({ date: checkIns.date })
    .from(checkIns)
    .where(and(eq(checkIns.userId, userId), eq(checkIns.date, today)))
    .limit(1)

  // 今天已经打过卡：直接回成功态，**不再校验门槛**。
  // 理由：用户可能打完卡之后把目标调高了，那不该让"已经打过的卡"变成失败。
  if (existing) return alreadyDone()

  const remaining = sentencesToCheckIn(todaySentences, checkInGoal)
  if (remaining > 0) {
    return NextResponse.json(
      { error: "need_more_practice", todaySentences, checkInGoal, remaining },
      { status: 403 }
    )
  }

  // 占坑：INSERT IGNORE 的 affectedRows 决定「今天是不是我第一个打上的」。
  const claimResult = await database
    .insert(checkIns)
    .ignore()
    .values({ userId, date: today })

  // drizzle 的 mysql2 insert 返回 [ResultSetHeader, ...]
  const affected = Array.isArray(claimResult)
    ? Number((claimResult[0] as { affectedRows?: number } | undefined)?.affectedRows ?? 0)
    : 0

  // 并发/重复请求：另一路已经把今天占了，不重复发奖励。
  if (affected === 0) return alreadyDone()

  const streakDays = await readStreak()
  const coinsEarned = checkInCoinReward(streakDays)

  await database.transaction(async (tx) => {
    await tx.insert(coinLogs).values({
      userId,
      amount: coinsEarned,
      type: "check_in",
      streak: streakDays,
      date: today,
    })
    await tx
      .update(users)
      .set({ coins: sql`${users.coins} + ${coinsEarned}` })
      .where(eq(users.id, userId))
  })

  const [coinRow] = await database
    .select({ coins: users.coins })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)

  return NextResponse.json({
    success: true,
    alreadyCheckedIn: false,
    coinsEarned,
    streakDays,
    totalCoins: coinRow?.coins ?? 0,
    todaySentences,
    checkInGoal,
  })
}
