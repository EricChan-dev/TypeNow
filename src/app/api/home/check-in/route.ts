import { NextResponse } from "next/server"
import { getSession } from "@/lib/auth/session"
import { db } from "@/lib/db"
import { checkIns, diamondLogs, users } from "@/lib/db/schema"
import { eq, desc, and, sql } from "drizzle-orm"
import { computeStreak, toShanghaiDateStr } from "@/lib/practice-stats"

export async function POST() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })

  const today = toShanghaiDateStr()
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
        sql`DATE(${diamondLogs.createdAt}) = ${today}`
      )
    )
  const todayDiamonds = Number(diamondRow?.total ?? 0)

  if (todayDiamonds < checkInGoal) {
    return NextResponse.json(
      { error: "need_more_diamonds", todayDiamonds, checkInGoal },
      { status: 403 }
    )
  }

  // Check for duplicate BEFORE insert — avoids treating all DB errors as "already checked in"
  const [existingCheckIn] = await db
    .select({ date: checkIns.date })
    .from(checkIns)
    .where(and(eq(checkIns.userId, userId), eq(checkIns.date, today)))
    .limit(1)

  if (!existingCheckIn) {
    await db.insert(checkIns).values({ userId, date: today })
  }

  const allDates = await db
    .select({ date: checkIns.date })
    .from(checkIns)
    .where(eq(checkIns.userId, userId))
    .orderBy(desc(checkIns.date))
    .limit(400)

  const streakDays = computeStreak(allDates.map((r) => r.date), today)

  return NextResponse.json({ success: true, streakDays, alreadyCheckedIn: !!existingCheckIn })
}
