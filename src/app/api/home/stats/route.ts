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
} from "@/lib/db/schema"
import { eq, and, gte, desc, sql, count } from "drizzle-orm"

function toLocalDateStr(d = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
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

    // Heatmap: practice counts by date for last 365 days
    db
      .select({
        date: sql<string>`DATE(${practiceRecords.createdAt})`,
        cnt: count(),
      })
      .from(practiceRecords)
      .where(
        and(
          eq(practiceRecords.userId, userId),
          gte(practiceRecords.createdAt, yearAgo)
        )
      )
      .groupBy(sql`DATE(${practiceRecords.createdAt})`),

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
  ])

  const checkInDates = checkInResult.map((r) => r.date)
  const checkedInToday = checkInDates.includes(today)
  const streakDays = computeStreak(checkInDates)

  const heatmap: Record<string, number> = {}
  for (const row of heatmapResult) {
    heatmap[row.date] = Number(row.cnt)
  }

  // Build weekly array (last 7 days)
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

  return NextResponse.json({
    totalSentences: Number(totalResult[0]?.cnt ?? 0),
    totalDays: Number(totalDaysResult[0]?.cnt ?? 0),
    streakDays,
    todayCount: Number(todayResult[0]?.cnt ?? 0),
    pendingReviews: Number(pendingResult[0]?.cnt ?? 0),
    checkedInToday,
    heatmap,
    weekly,
    lastStudied,
    checkInDatesThisMonth,
  })
}
