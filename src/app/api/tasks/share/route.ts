import { NextResponse } from "next/server"
import { getSession } from "@/lib/auth/session"
import { db } from "@/lib/db"
import { taskLogs, diamondLogs, users } from "@/lib/db/schema"
import { eq, sql } from "drizzle-orm"

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

export async function POST() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "请先登录" }, { status: 401 })
  if (!db) return NextResponse.json({ error: "服务未配置" }, { status: 500 })

  // Award diamonds first — if this fails, nothing is lost.
  // Then insert taskLog. If taskLog fails (duplicate key), diamonds were already
  // awarded which is the safer direction (user keeps reward rather than losing it).
  await Promise.all([
    db.insert(diamondLogs).values({
      userId: session.userId,
      amount: 10,
      type: "share_invite",
    }),
    db.update(users)
      .set({ diamonds: sql`${users.diamonds} + 10` })
      .where(eq(users.id, session.userId)),
  ])

  try {
    await db.insert(taskLogs).values({
      userId: session.userId,
      taskType: "share_invite",
      rewardType: "diamond",
      rewardAmount: 10,
      date: todayStr(),
    })
  } catch {
    return NextResponse.json({ success: false, alreadyClaimed: true })
  }

  return NextResponse.json({ success: true, alreadyClaimed: false })
}
