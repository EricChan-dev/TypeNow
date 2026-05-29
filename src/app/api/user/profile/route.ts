import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth/session"
import { db } from "@/lib/db"
import { users } from "@/lib/db/schema"
import { eq } from "drizzle-orm"

export async function PUT(request: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })

  const body = await request.json()
  const { name, avatar, checkInGoal } = body

  const updates: Record<string, string | number> = {}

  if (typeof name === "string") {
    const trimmed = name.trim().slice(0, 100)
    if (trimmed.length > 0) updates.name = trimmed
  }

  if (typeof avatar === "string") {
    if (!avatar.startsWith("data:image/")) {
      return NextResponse.json({ error: "非法图片格式" }, { status: 400 })
    }
    // base64 of 1.5MB file ≈ 2MB string
    if (avatar.length > 2 * 1024 * 1024) {
      return NextResponse.json({ error: "图片过大，请压缩后上传" }, { status: 400 })
    }
    updates.avatar = avatar
  }

  if (typeof checkInGoal === "number") {
    const goal = Math.round(checkInGoal)
    if (goal < 10 || goal > 300) {
      return NextResponse.json({ error: "签到目标须在 10~300 之间" }, { status: 400 })
    }
    updates.checkInGoal = goal
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "无变更" }, { status: 400 })
  }

  await db.update(users).set(updates).where(eq(users.id, session.userId))

  return NextResponse.json({ success: true })
}
