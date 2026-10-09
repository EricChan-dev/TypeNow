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
  wordbookItems,
  pronunciationScores,
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
  // 今日零点（上海墙上时间）。DATETIME 列以 +08:00 墙上时间存储（见 lib/db），
  // 所以直接与日期串前缀比较即可，不需要 CONVERT_TZ。
  const todayStart = `${today} 00:00:00`

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
    totalDurationResult,
    totalMistakesResult,
    reviewBreakdownResult,
    wordbookCountResult,
    pronunciationTodayResult,
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

    // 累计练习时长（秒，全历史）—— 首页「千小时进度」用。
    // 与热力图同源（coin_logs.duration_seconds），但**不带 365 天窗口**：
    // 千小时是长期目标，只统计最近一年会让进度条无故回退。
    db
      .select({ total: sql<number>`COALESCE(SUM(${coinLogs.durationSeconds}), 0)` })
      .from(coinLogs)
      .where(eq(coinLogs.userId, userId)),

    // 累计错题（全历史）—— 首页「错题统计」用。
    // practice_records.mistakes 由练习页上报（见 api/practice/record），是唯一
    // 存有错题数的列，没有分类字段 —— 所以下面「分类」用待复习状态的三个区间代替。
    db
      .select({ total: sql<number>`COALESCE(SUM(${practiceRecords.mistakes}), 0)` })
      .from(practiceRecords)
      .where(eq(practiceRecords.userId, userId)),

    // 错题按掌握程度分档（借 review_queue 的 FSRS 字段，替代参考页那套
    // 拼写/语法/词汇三分类 —— 我们库里没有分类字段，硬造会得到三个恒为 0 的死格）。
    // 分档口径与 lib/review-utils.ts 的 masteryLabel 保持一致：
    //   status='done' → 已掌握；consecutive_ok>=3 → 接近掌握；其余 → 复习中。
    db
      .select({
        mastered: sql<number>`SUM(CASE WHEN ${reviewQueue.status} = 'done' THEN 1 ELSE 0 END)`,
        almost: sql<number>`SUM(CASE WHEN ${reviewQueue.status} <> 'done' AND ${reviewQueue.consecutiveOk} >= 3 THEN 1 ELSE 0 END)`,
        reviewing: sql<number>`SUM(CASE WHEN ${reviewQueue.status} <> 'done' AND ${reviewQueue.consecutiveOk} < 3 THEN 1 ELSE 0 END)`,
      })
      .from(reviewQueue)
      .where(eq(reviewQueue.userId, userId)),

    // 单词本词量 —— 首页「词汇学习」卡片用（取代参考页的词汇学习圆环）。
    db
      .select({ cnt: count() })
      .from(wordbookItems)
      .where(eq(wordbookItems.userId, userId)),

    // 今日 AI 口语评测次数 —— 首页会员卡的第二个指标。
    //
    // 为什么按「次数」而不是参考页的「分钟配额」：我们的额度单位本来就是 AI 调用
    // 次数（FREE_PRONUNCIATION_PER_DAY=3 / PRO=30，见 lib/membership-benefits.ts），
    // 从来没有「分钟」这个概念。照抄参考页的分钟口径会得到一个无法与后端对账的数字。
    //
    // 按 sentence_id 计数而不是 COUNT(*)：这张表对 (user_id, sentence_id) 有唯一键，
    // 同一条重录是覆盖更新，所以 COUNT(*) 与 COUNT(DISTINCT) 结果相同 —— 用后者是把
    // 「一次评测 = 一条记录」这个不变量写进查询里，即使将来唯一键变了也不会重复计数。
    db
      .select({ cnt: sql<number>`COUNT(DISTINCT ${pronunciationScores.sentenceId})` })
      .from(pronunciationScores)
      .where(
        and(
          eq(pronunciationScores.userId, userId),
          sql`${pronunciationScores.createdAt} >= ${todayStart}`
        )
      ),
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

  // 千小时进度的两个口径：累计秒数（原始）与累计小时（前端直接显示）。
  // 一千小时是目标常量，前端按 totalDurationHours / 1000 画进度条。
  const totalDurationSeconds = Number(totalDurationResult[0]?.total ?? 0)
  const totalDurationHours = totalDurationSeconds / 3600

  const totalMistakes = Number(totalMistakesResult[0]?.total ?? 0)
  const reviewBreakdown = {
    mastered: Number(reviewBreakdownResult[0]?.mastered ?? 0),
    almost: Number(reviewBreakdownResult[0]?.almost ?? 0),
    reviewing: Number(reviewBreakdownResult[0]?.reviewing ?? 0),
  }
  const wordbookCount = Number(wordbookCountResult[0]?.cnt ?? 0)
  const pronunciationToday = Number(pronunciationTodayResult[0]?.cnt ?? 0)

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
    // 首页改版（参考句游英语版式）新增的真实聚合字段：
    totalDurationSeconds,
    totalDurationHours,
    totalMistakes,
    reviewBreakdown,
    wordbookCount,
    pronunciationToday,
  })
}
