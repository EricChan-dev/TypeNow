import { NextResponse } from "next/server"
import { getSession } from "@/lib/auth/session"
import { db } from "@/lib/db"
import {
  practiceRecords,
  reviewQueue,
  checkIns,
  sentences,
  lessons,
  courses,
  coinLogs,
  users,
} from "@/lib/db/schema"
import { eq, and, gte, desc, sql, count } from "drizzle-orm"
import {
  buildDailySeries,
  computeStreak,
  shiftShanghaiDate,
  toShanghaiDateStr,
} from "@/lib/practice-stats"
import { CHECK_IN_GOAL_DEFAULT } from "@/lib/coins"

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })

  const userId = session.userId
  const today = toShanghaiDateStr()
  // 热力图按 coin_logs.date（VARCHAR 'YYYY-MM-DD'）过滤，所以用日期串比较，
  // 不再用 created_at 的时间戳 —— ISO 日期串的字典序与时间序一致。
  const yearAgoDate = shiftShanghaiDate(today, -365)

  // 全站统一 Asia/Shanghai 口径：DATETIME 以 +08:00 墙上时间存储（见 lib/db），
  // 所以 DATE(created_at) 直接就是上海日历日，签到 / streak / 热力图 / 练习量同源。
  const weekStart = `${shiftShanghaiDate(today, -6)} 00:00:00`

  const thisMonthStart = `${today.slice(0, 7)}-01`

  const [
    totalResult,
    totalDaysResult,
    todayResult,
    pendingResult,
    heatmapResult,
    checkInResult,
    lastStudiedResult,
    checkInsThisMonthResult,
    userGoalResult,
    recentPracticesResult,
    weeklyResult,
  ] = await Promise.all([
    // Total sentences practiced (all time)
    db
      .select({ cnt: count() })
      .from(practiceRecords)
      .where(eq(practiceRecords.userId, userId)),

    // Total distinct days practiced
    db
      .select({ cnt: sql<number>`COUNT(DISTINCT DATE(${practiceRecords.createdAt}))` })
      .from(practiceRecords)
      .where(eq(practiceRecords.userId, userId)),

    // Today's sentence count (Asia/Shanghai)
    db
      .select({ cnt: count() })
      .from(practiceRecords)
      .where(
        and(
          eq(practiceRecords.userId, userId),
          sql`DATE(${practiceRecords.createdAt}) = ${today}`
        )
      ),

    // Pending reviews
    db
      .select({ cnt: count() })
      .from(reviewQueue)
      .where(
        and(
          eq(reviewQueue.userId, userId),
          eq(reviewQueue.status, "pending")
        )
      ),

    // Heatmap: 每日获得的金币与练习时长，最近 365 天。
    //
    // 2026-09-29 数据源由 diamond_logs 改为 coin_logs：练习奖励已改发金币，
    // 而热力图表达的是**学习活跃度**，跟着奖励货币走才不会变成空白。
    // 响应字段名（heatmap / heatmapDuration）保持不变，所以前端无需改动。
    //
    // 练习时长也只记在这一张表上（practice_records 没有 duration_seconds 列，
    // 时长是在领奖请求里上报的），两个指标必须同源才不会一个有一个没有。
    db
      .select({
        date: coinLogs.date,
        coins: sql<number>`COALESCE(SUM(${coinLogs.amount}), 0)`,
        duration: sql<number>`COALESCE(SUM(${coinLogs.durationSeconds}), 0)`,
      })
      .from(coinLogs)
      .where(
        and(
          eq(coinLogs.userId, userId),
          gte(coinLogs.date, yearAgoDate)
        )
      )
      .groupBy(coinLogs.date),

    // Check-in dates for last 400 days (for streak calc)
    db
      .select({ date: checkIns.date })
      .from(checkIns)
      .where(eq(checkIns.userId, userId))
      .orderBy(desc(checkIns.date))
      .limit(400),

    // Last studied course/lesson
    db
      .select({
        courseId: courses.id,
        lessonId: lessons.id,
        courseTitle: courses.title,
        lessonTitle: lessons.title,
        studiedAt: practiceRecords.createdAt,
      })
      .from(practiceRecords)
      .innerJoin(sentences, eq(practiceRecords.sentenceId, sentences.id))
      .innerJoin(lessons, eq(sentences.lessonId, lessons.id))
      .innerJoin(courses, eq(lessons.courseId, courses.id))
      .where(eq(practiceRecords.userId, userId))
      .orderBy(desc(practiceRecords.createdAt))
      .limit(1),

    // Check-ins this month (for monthly calendar)
    db
      .select({ date: checkIns.date })
      .from(checkIns)
      .where(
        and(
          eq(checkIns.userId, userId),
          gte(checkIns.date, thisMonthStart)
        )
      ),

    // User's check-in goal（打卡目标＝当日练习句数，语义见 lib/coins.ts）
    //
    // 这里**不再**单独查「今日钻石数」：打卡门槛已改为练习句数，而今日句数就是
    // 上面的 todayResult，没必要再查一遍；也不该再暴露一个会误导人的钻石口径
    // （前端据此显示"还差 N 颗💎"会与实际门槛完全对不上）。
    db
      .select({ checkInGoal: users.checkInGoal })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1),

    // Recent practices (last 8)
    db
      .select({
        courseId: courses.id,
        lessonId: lessons.id,
        courseTitle: courses.title,
        lessonTitle: lessons.title,
        sentenceText: sentences.english,
        studiedAt: practiceRecords.createdAt,
      })
      .from(practiceRecords)
      .innerJoin(sentences, eq(practiceRecords.sentenceId, sentences.id))
      .innerJoin(lessons, eq(sentences.lessonId, lessons.id))
      .innerJoin(courses, eq(lessons.courseId, courses.id))
      .where(eq(practiceRecords.userId, userId))
      .orderBy(desc(practiceRecords.createdAt))
      .limit(8),

    // Weekly practice counts (last 7 days, Asia/Shanghai) — 练习量维度，不用钻石
    db
      .select({
        date: sql<string>`DATE(${practiceRecords.createdAt})`,
        count: count(),
      })
      .from(practiceRecords)
      .where(
        and(
          eq(practiceRecords.userId, userId),
          sql`${practiceRecords.createdAt} >= ${weekStart}`
        )
      )
      .groupBy(sql`DATE(${practiceRecords.createdAt})`),
  ])

  const checkInDates = checkInResult.map((r) => r.date)
  const checkedInToday = checkInDates.includes(today)
  const streakDays = computeStreak(checkInDates, today)

  const heatmap: Record<string, number> = {}
  const heatmapDuration: Record<string, number> = {}
  for (const row of heatmapResult) {
    heatmap[row.date] = Number(row.coins)
    heatmapDuration[row.date] = Number(row.duration)
  }

  // 本周练习序列：连续 7 天，最后一项恒为「今天」（上海时区），前端不必自己算时区
  const weekly = buildDailySeries(
    weeklyResult.map((r) => ({ date: r.date, count: Number(r.count) })),
  )

  const lastStudied = lastStudiedResult[0]
    ? {
        courseId: lastStudiedResult[0].courseId,
        lessonId: lastStudiedResult[0].lessonId,
        courseTitle: lastStudiedResult[0].courseTitle,
        lessonTitle: lastStudiedResult[0].lessonTitle,
        studiedAt: lastStudiedResult[0].studiedAt?.toISOString() ?? "",
      }
    : null

  const checkInDatesThisMonth = checkInsThisMonthResult.map((r) => r.date)
  // 打卡进度＝今日练习句数 / 打卡目标（目标语义见 lib/coins.ts：练习句数，非货币）
  const todaySentences = Number(todayResult[0]?.cnt ?? 0)
  const checkInGoal = userGoalResult[0]?.checkInGoal ?? CHECK_IN_GOAL_DEFAULT

  // Deduplicate by (courseId, lessonId), keeping the latest
  const seenKey = new Set<string>()
  const recentPractices = recentPracticesResult
    .filter((r) => {
      const key = `${r.courseId}-${r.lessonId}`
      if (seenKey.has(key)) return false
      seenKey.add(key)
      return true
    })
    .map((r) => ({
      courseId: r.courseId,
      lessonId: r.lessonId,
      courseTitle: r.courseTitle,
      lessonTitle: r.lessonTitle,
      sentenceText: r.sentenceText,
      studiedAt: r.studiedAt?.toISOString() ?? "",
    }))

  return NextResponse.json({
    totalSentences: Number(totalResult[0]?.cnt ?? 0),
    totalDays: Number(totalDaysResult[0]?.cnt ?? 0),
    streakDays,
    todayCount: Number(todayResult[0]?.cnt ?? 0),
    pendingReviews: Number(pendingResult[0]?.cnt ?? 0),
    checkedInToday,
    heatmap,
    heatmapDuration,
    weekly,
    lastStudied,
    recentPractices,
    checkInDatesThisMonth,
    todaySentences,
    checkInGoal,
  })
}
