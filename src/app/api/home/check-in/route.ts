import { NextResponse } from "next/server"
import { getSession } from "@/lib/auth/session"
import { db } from "@/lib/db"
import { checkIns } from "@/lib/db/schema"
import { eq, desc } from "drizzle-orm"

function toLocalDateStr(d = new Date()): string {
  return d.toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" })
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
  let alreadyCheckedIn = false

  try {
    await db.insert(checkIns).values({ userId: session.userId, date: today })
  } catch {
    // Duplicate key = already checked in today
    alreadyCheckedIn = true
  }

  const allDates = await db
    .select({ date: checkIns.date })
    .from(checkIns)
    .where(eq(checkIns.userId, session.userId))
    .orderBy(desc(checkIns.date))
    .limit(400)

  const streakDays = computeStreak(allDates.map((r) => r.date))

  return NextResponse.json({ success: true, streakDays, alreadyCheckedIn })
}
