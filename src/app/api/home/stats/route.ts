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
  diamondLogs,
  users,
} from "@/lib/db/schema"
import { eq, and, gte, desc, sql, count } from "drizzle-orm"

function toLocalDateStr(d = new Date()): string {
  return d.toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" })
}

function computeStreak(sortedDates: string[]): number {
  if (sortedDates.length === 0) return 0
  const today = toLocalDateStr()
  const yesterday = toLocalDateStr(new Date(Date.now() - 86400000))

  // Start from today if present, else from yesterday
  let expected = sortedDates[0] === today ? today : yesterday
  let streak = 0

  for (const date of sortedDates) {
    if (date === expected) {
      streak++
      const prev = new Date(date)
      prev.setDate(prev.getDate() - 1)
      expected = toLocalDateStr(prev)
    } else if (date < expected) {
      break
    }
  }
  return streak
}

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })

  const userId = session.userId
  const today = toLocalDateStr()
  const yearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000)

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
    todayDiamondResult,
    userGoalResult,
    recentPracticesResult,
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

    // Today's sentence count
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

    // Heatmap: diamonds by date for last 365 days
    db
      .select({
        date: sql<string>`DATE(CONVERT_TZ(${diamondLogs.createdAt}, '+00:00', '+08:00'))`,
        diamonds: sql<number>`COALESCE(SUM(${diamondLogs.amount}), 0)`,
        duration: sql<number>`COALESCE(SUM(${diamondLogs.durationSeconds}), 0)`,
      })
      .from(diamondLogs)
      .where(
        and(
          eq(diamondLogs.userId, userId),
          gte(diamondLogs.createdAt, yearAgo)
        )
      )
      .groupBy(sql`DATE(CONVERT_TZ(${diamondLogs.createdAt}, '+00:00', '+08:00'))`),

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

    // Today's diamond total
    db
      .select({ total: sql<number>`COALESCE(SUM(${diamondLogs.amount}), 0)` })
      .from(diamondLogs)
      .where(
        and(
          eq(diamondLogs.userId, userId),
          sql`DATE(CONVERT_TZ(${diamondLogs.createdAt}, '+00:00', '+08:00')) = ${today}`
        )
      ),

    // User's check-in goal
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
  ])

  const checkInDates = checkInResult.map((r) => r.date)
  const checkedInToday = checkInDates.includes(today)
  const streakDays = computeStreak(checkInDates)

  const heatmap: Record<string, number> = {}
  const heatmapDuration: Record<string, number> = {}
  for (const row of heatmapResult) {
    heatmap[row.date] = Number(row.diamonds)
    heatmapDuration[row.date] = Number(row.duration)
  }

  // Build weekly array (last 7 days) — count from practice_records stays for weekly display
  const weekly = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(Date.now() - (6 - i) * 86400000)
    const dateStr = toLocalDateStr(d)
    return { date: dateStr, count: heatmap[dateStr] ?? 0 }
  })

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
  const todayDiamonds = Number(todayDiamondResult[0]?.total ?? 0)
  const checkInGoal = userGoalResult[0]?.checkInGoal ?? 50

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
    todayDiamonds,
    checkInGoal,
  })
}
