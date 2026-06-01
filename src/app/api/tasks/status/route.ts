import { NextResponse } from "next/server"
import { getSession } from "@/lib/auth/session"
import { db } from "@/lib/db"
import { checkIns, taskLogs, users } from "@/lib/db/schema"
import { eq, and, count } from "drizzle-orm"

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "请先登录" }, { status: 401 })
  if (!db) return NextResponse.json({ error: "服务未配置" }, { status: 500 })

  const today = new Date().toISOString().slice(0, 10)

  const [checkInRow, shareRow, inviteRows, userRow] = await Promise.all([
    db.select({ id: checkIns.id }).from(checkIns)
      .where(and(eq(checkIns.userId, session.userId), eq(checkIns.date, today)))
      .limit(1),
    db.select({ id: taskLogs.id }).from(taskLogs)
      .where(and(
        eq(taskLogs.userId, session.userId),
        eq(taskLogs.taskType, "share_invite"),
        eq(taskLogs.date, today),
      ))
      .limit(1),
    db.select({ total: count() }).from(taskLogs)
      .where(and(
        eq(taskLogs.userId, session.userId),
        eq(taskLogs.taskType, "invite_register"),
      )),
    db.select({ inviteCode: users.inviteCode, diamonds: users.diamonds }).from(users)
      .where(eq(users.id, session.userId))
      .limit(1),
  ])

  return NextResponse.json({
    checkIn: checkInRow.length > 0,
    share: shareRow.length > 0,
    inviteTotal: inviteRows[0]?.total ?? 0,
    inviteCode: userRow[0]?.inviteCode ?? null,
    diamonds: userRow[0]?.diamonds ?? 0,
  })
}
