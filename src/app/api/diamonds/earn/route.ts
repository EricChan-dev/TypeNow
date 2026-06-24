import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth/session"
import { db } from "@/lib/db"
import { diamondLogs, users } from "@/lib/db/schema"
import { eq, and, sql } from "drizzle-orm"

function toLocalDateStr(d = new Date()): string {
  return d.toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" })
}

function calcEarned(type: string, streak: number, perfect: boolean): number {
  if (type === "lesson_complete") return 30
  if (type === "course_complete") return 100
  // sentence
  if (!perfect) return 5            // Great
  if (streak <= 1) return 5         // Perfect ×1 — no combo bonus
  return 5 + Math.min(streak, 20)   // Perfect combo (streak ≥ 2)
}

export async function POST(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })

    let body: Record<string, unknown>
    try { body = await request.json() } catch { return NextResponse.json({ error: "请求格式错误" }, { status: 400 }) }
  const {
    type,
    refId,
    streak = 0,
    perfect = false,
    durationSeconds,
  }: {
    type: "sentence" | "lesson_complete" | "course_complete"
    refId?: string
    streak?: number
    perfect?: boolean
    durationSeconds?: number
  } = body

  if (!["sentence", "lesson_complete", "course_complete"].includes(type)) {
    return NextResponse.json({ error: "Invalid type" }, { status: 400 })
  }

  const userId = session.userId
  const earned = calcEarned(type, streak, perfect)
  const today = toLocalDateStr()

  await db.insert(diamondLogs).values({
    userId,
    amount: earned,
    durationSeconds: durationSeconds ?? null,
    type,
    refId: refId ?? null,
    streak,
  })

  await db
    .update(users)
    .set({ diamonds: sql`${users.diamonds} + ${earned}` })
    .where(eq(users.id, userId))

  const [todayRow] = await db
    .select({
      todayDiamonds: sql<number>`COALESCE(SUM(${diamondLogs.amount}), 0)`,
      todayDuration: sql<number>`COALESCE(SUM(${diamondLogs.durationSeconds}), 0)`,
    })
    .from(diamondLogs)
    .where(
      and(
        eq(diamondLogs.userId, userId),
        sql`DATE(CONVERT_TZ(${diamondLogs.createdAt}, '+00:00', '+08:00')) = ${today}`
      )
    )

  const [userRow] = await db
    .select({ diamonds: users.diamonds })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)

  return NextResponse.json({
    earned,
    totalDiamonds: userRow?.diamonds ?? 0,
    todayDiamonds: Number(todayRow?.todayDiamonds ?? 0),
    todayDurationSeconds: Number(todayRow?.todayDuration ?? 0),
  })
  } catch (e) {
    console.error("[diamonds/earn]", e)
    return NextResponse.json({ earned: 0 }, { status: 500 })
  }
}
