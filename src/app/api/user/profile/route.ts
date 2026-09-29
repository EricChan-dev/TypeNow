import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth/session"
import { db } from "@/lib/db"
import { users } from "@/lib/db/schema"
import { eq } from "drizzle-orm"
import { CHECK_IN_GOAL_MAX, CHECK_IN_GOAL_MIN, clampCheckInGoal } from "@/lib/coins"

export async function PUT(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })

    let body: { name?: string; avatar?: string; checkInGoal?: number }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: "请求格式错误" }, { status: 400 })
    }
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
    // 打卡目标＝**当日练习句数**（语义见 lib/coins.ts）。
    // 区间必须取自那里，不能在本文件再写一份 —— 旧实现的 10~300 是"钻石数"
    // 时代的区间，在新语义下 300 句意味着"今天要练 300 句"，等于把打卡关掉。
    if (
      !Number.isFinite(checkInGoal) ||
      checkInGoal < CHECK_IN_GOAL_MIN ||
      checkInGoal > CHECK_IN_GOAL_MAX
    ) {
      return NextResponse.json(
        { error: `打卡目标须在 ${CHECK_IN_GOAL_MIN}~${CHECK_IN_GOAL_MAX} 句之间` },
        { status: 400 },
      )
    }
    updates.checkInGoal = clampCheckInGoal(checkInGoal)
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "无变更" }, { status: 400 })
  }

  await db.update(users).set(updates).where(eq(users.id, session.userId))

  return NextResponse.json({ success: true })
  } catch (e) {
    console.error("[user/profile]", e)
    return NextResponse.json({ error: "更新个人信息失败" }, { status: 500 })
  }
}
