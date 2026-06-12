import { NextResponse } from "next/server"
import { getSession } from "@/lib/auth/session"
import { db } from "@/lib/db"
import { checkIns, diamondLogs, users } from "@/lib/db/schema"
import { eq, desc, and, sql } from "drizzle-orm"

function toLocalDateStr(d = new Date()): string {
  return d.toISOString().slice(0, 10)
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

export async function POST() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })

  const today = toLocalDateStr()
  const userId = session.userId

  // Verify diamond goal
  const [userRow] = await db
    .select({ checkInGoal: users.checkInGoal })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  const checkInGoal = userRow?.checkInGoal ?? 50

  const [diamondRow] = await db
    .select({ total: sql<number>`COALESCE(SUM(${diamondLogs.amount}), 0)` })
    .from(diamondLogs)
    .where(
      and(
        eq(diamondLogs.userId, userId),
        sql`DATE(CONVERT_TZ(${diamondLogs.createdAt}, '+00:00', '+08:00')) = ${today}`
      )
    )
  const todayDiamonds = Number(diamondRow?.total ?? 0)

  if (todayDiamonds < checkInGoal) {
    return NextResponse.json(
      { error: "need_more_diamonds", todayDiamonds, checkInGoal },
      { status: 403 }
    )
  }

  let alreadyCheckedIn = false

  try {
    await db.insert(checkIns).values({ userId, date: today })
  } catch {
    // Duplicate key = already checked in today
    alreadyCheckedIn = true
  }

  const allDates = await db
    .select({ date: checkIns.date })
    .from(checkIns)
    .where(eq(checkIns.userId, userId))
    .orderBy(desc(checkIns.date))
    .limit(400)

  const streakDays = computeStreak(allDates.map((r) => r.date))

  return NextResponse.json({ success: true, streakDays, alreadyCheckedIn })
}
