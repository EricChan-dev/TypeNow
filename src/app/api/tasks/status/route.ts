import { NextResponse } from "next/server"
import { getSession } from "@/lib/auth/session"
import { db } from "@/lib/db"
import { checkIns, taskLogs, users } from "@/lib/db/schema"
import { eq, and, count } from "drizzle-orm"
import { toShanghaiDateStr } from "@/lib/practice-stats"

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "请先登录" }, { status: 401 })
  if (!db) return NextResponse.json({ error: "服务未配置" }, { status: 500 })

  const today = toShanghaiDateStr()

  const [checkInRow, shareRow, inviteRows, invitePaidRows, userRow] = await Promise.all([
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
    // 已付费的被邀请人数。这是「邀请有礼」真正发天数的那一档，用户最关心的数字，
    // 也是句乐部邀请后台里有的「成功付费人数」口径。
    db.select({ total: count() }).from(taskLogs)
      .where(and(
        eq(taskLogs.userId, session.userId),
        eq(taskLogs.taskType, "invite_purchase"),
      )),
    db.select({ inviteCode: users.inviteCode, diamonds: users.diamonds }).from(users)
      .where(eq(users.id, session.userId))
      .limit(1),
  ])

  return NextResponse.json({
    checkIn: checkInRow.length > 0,
    share: shareRow.length > 0,
    inviteTotal: inviteRows[0]?.total ?? 0,
    invitePaidTotal: invitePaidRows[0]?.total ?? 0,
    inviteCode: userRow[0]?.inviteCode ?? null,
    diamonds: userRow[0]?.diamonds ?? 0,
  })
}
