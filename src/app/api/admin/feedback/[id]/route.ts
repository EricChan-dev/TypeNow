import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { userFeedback } from "@/lib/db/schema"
import { requireAdmin } from "@/lib/admin-auth"
import { isFeedbackStatus } from "@/lib/feedback"
import { eq } from "drizzle-orm"

/** 处理备注的长度上限：与提交内容的上限（500）保持一致，避免后台塞进超长文本 */
const MAX_NOTE = 500

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth
  if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })

  const { id } = await params
  const [row] = await db.select().from(userFeedback).where(eq(userFeedback.id, id)).limit(1)
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 })
  return NextResponse.json({ data: row })
}

/**
 * 更新反馈的处理状态与备注。
 *
 * 两点刻意设计：
 *
 * 1. **状态与备注分开处理**。只改备注时不该动 handled_at ——
 *    否则"最后处理时间"会被纯编辑操作刷新，看不出真实的处理节奏。
 *    所以只有**状态真的发生变化**时才写 handled_by / handled_at。
 *
 * 2. **回到 open 时清空处理痕迹**。把一条已解决的反馈退回待处理，
 *    是在说"这个处理不算数"，留着旧的处理人和时间会误导人。
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth
  if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })
  const database = db

  const { id } = await params
  const body = await request.json().catch(() => ({}))
  const { status, adminNote } = body as { status?: unknown; adminNote?: unknown }

  if (status !== undefined && !isFeedbackStatus(status)) {
    return NextResponse.json({ error: "无效的状态" }, { status: 400 })
  }
  if (adminNote !== undefined && typeof adminNote !== "string") {
    return NextResponse.json({ error: "备注必须是文本" }, { status: 400 })
  }
  if (typeof adminNote === "string" && adminNote.length > MAX_NOTE) {
    return NextResponse.json({ error: `备注不能超过 ${MAX_NOTE} 字` }, { status: 400 })
  }
  if (status === undefined && adminNote === undefined) {
    return NextResponse.json({ error: "没有要更新的内容" }, { status: 400 })
  }

  const [existing] = await database
    .select({ id: userFeedback.id, status: userFeedback.status })
    .from(userFeedback)
    .where(eq(userFeedback.id, id))
    .limit(1)
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const patch: Record<string, unknown> = {}
  if (typeof adminNote === "string") patch.adminNote = adminNote.trim() || null

  const nextStatus = status as string | undefined
  if (nextStatus !== undefined && nextStatus !== existing.status) {
    patch.status = nextStatus
    if (nextStatus === "open") {
      // 退回待处理 = 之前那次处理不算数，清空痕迹
      patch.handledBy = null
      patch.handledAt = null
    } else {
      patch.handledBy = auth.userId
      patch.handledAt = new Date()
    }
  }

  if (Object.keys(patch).length === 0) {
    // 状态没变、也没给备注：什么都没发生。返回现有记录而不是假装更新成功
    const [row] = await database.select().from(userFeedback).where(eq(userFeedback.id, id)).limit(1)
    return NextResponse.json({ data: row, unchanged: true })
  }

  await database.update(userFeedback).set(patch).where(eq(userFeedback.id, id))
  const [row] = await database.select().from(userFeedback).where(eq(userFeedback.id, id)).limit(1)
  return NextResponse.json({ data: row })
}
