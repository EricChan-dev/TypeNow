import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth/session"
import { db } from "@/lib/db"
import {
  practiceRecords,
  checkIns,
  sentences,
  lessons,
  courses,
} from "@/lib/db/schema"
import { eq, and, gte, desc, sql, count, max, avg, sum } from "drizzle-orm"

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

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })

  const userId = session.userId
  const period = req.nextUrl.searchParams.get("period") ?? "all"
  const today = toLocalDateStr()
  const yearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000)

  // Period filter date
  let periodStart: Date | null = null
  if (period === "week") periodStart = new Date(Date.now() - 7 * 86400000)
  else if (period === "month") periodStart = new Date(Date.now() - 30 * 86400000)

  const periodFilter = periodStart
    ? and(eq(practiceRecords.userId, userId), gte(practiceRecords.createdAt, periodStart))
    : eq(practiceRecords.userId, userId)

  const [
    learningDaysResult,
    totalSentencesResult,
    checkInResult,
    scoreResult,
    completedCoursesResult,
    heatmapResult,
    trendResult,
  ] = await Promise.all([
    // Learning days (period)
    db
      .select({ cnt: sql<number>`COUNT(DISTINCT DATE(${practiceRecords.createdAt}))` })
      .from(practiceRecords)
      .where(periodFilter),

    // Total sentences (period)
    db
      .select({ cnt: count() })
      .from(practiceRecords)
      .where(periodFilter),

    // Check-in dates (all time, for streak)
    db
      .select({ date: checkIns.date })
      .from(checkIns)
      .where(eq(checkIns.userId, userId))
      .orderBy(desc(checkIns.date))
      .limit(400),

    // Scores (period)
    db
      .select({
        bestScore: max(practiceRecords.score),
        avgScore: avg(practiceRecords.score),
        totalMistakes: sum(practiceRecords.mistakes),
      })
      .from(practiceRecords)
      .where(periodFilter),

    // Completed courses (period)
    db
      .selectDistinct({ courseId: courses.id })
      .from(practiceRecords)
      .innerJoin(sentences, eq(practiceRecords.sentenceId, sentences.id))
      .innerJoin(lessons, eq(sentences.lessonId, lessons.id))
      .innerJoin(courses, eq(lessons.courseId, courses.id))
      .where(periodFilter),

    // Heatmap (last 365 days, always)
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

    // Trend (period — daily counts)
    db
      .select({
        date: sql<string>`DATE(${practiceRecords.createdAt})`,
        cnt: count(),
      })
      .from(practiceRecords)
      .where(periodFilter)
      .groupBy(sql`DATE(${practiceRecords.createdAt})`)
      .orderBy(sql`DATE(${practiceRecords.createdAt})`),
  ])

  const checkInDates = checkInResult.map((r) => r.date)
  const streakDays = computeStreak(checkInDates)

  const heatmap: Record<string, number> = {}
  for (const row of heatmapResult) {
    heatmap[row.date] = Number(row.cnt)
  }

  const trend = trendResult.map((r) => ({ date: r.date, count: Number(r.cnt) }))

  // Fill in missing days in trend for week/month views
  if (period === "week" || period === "month") {
    const days = period === "week" ? 7 : 30
    const trendMap = new Map(trend.map((t) => [t.date, t.count]))
    const filled = Array.from({ length: days }, (_, i) => {
      const d = new Date(Date.now() - (days - 1 - i) * 86400000)
      const dateStr = toLocalDateStr(d)
      return { date: dateStr, count: trendMap.get(dateStr) ?? 0 }
    })
    return NextResponse.json({
      learningDays: Number(learningDaysResult[0]?.cnt ?? 0),
      totalSentences: Number(totalSentencesResult[0]?.cnt ?? 0),
      streakDays,
      completedCourses: completedCoursesResult.length,
      bestScore: Number(scoreResult[0]?.bestScore ?? 0),
      avgScore: Math.round(Number(scoreResult[0]?.avgScore ?? 0)),
      totalMistakes: Number(scoreResult[0]?.totalMistakes ?? 0),
      trend: filled,
      heatmap,
      today,
    })
  }

  return NextResponse.json({
    learningDays: Number(learningDaysResult[0]?.cnt ?? 0),
    totalSentences: Number(totalSentencesResult[0]?.cnt ?? 0),
    streakDays,
    completedCourses: completedCoursesResult.length,
    bestScore: Number(scoreResult[0]?.bestScore ?? 0),
    avgScore: Math.round(Number(scoreResult[0]?.avgScore ?? 0)),
    totalMistakes: Number(scoreResult[0]?.totalMistakes ?? 0),
    trend,
    heatmap,
    today,
  })
}
