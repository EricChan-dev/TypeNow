import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { restoreLesson, softDeleteLesson } from "@/lib/soft-delete"
import { lessons } from "@/lib/db/schema"
import { requireAdmin } from "@/lib/admin-auth"
import { diffAuditFields, logAdminAction } from "@/lib/admin-audit"
import { eq } from "drizzle-orm"

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth
  if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })

  const { id } = await params
  const [row] = await db.select().from(lessons).where(eq(lessons.id, id)).limit(1)
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 })

  return NextResponse.json({ data: row })
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth
  if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })

  const { id } = await params
  const body = await request.json()
  const { courseId, title, summary, sortOrder } = body

  // 先读现状，用于算出"这次改了哪几个字段"；同时挡住不存在的 id
  // （否则会写出一条"更新了某课时"的假审计）
  const [before] = await db.select().from(lessons).where(eq(lessons.id, id)).limit(1)
  if (!before) return NextResponse.json({ error: "Not found" }, { status: 404 })

  await db.update(lessons).set({ courseId, title, summary, sortOrder }).where(eq(lessons.id, id))
  const [row] = await db.select().from(lessons).where(eq(lessons.id, id)).limit(1)

  await logAdminAction(auth, {
    action: "update",
    targetType: "lesson",
    targetId: id,
    targetLabel: row?.title ?? before.title,
    detail: diffAuditFields(before, row, ["courseId", "title", "summary", "sortOrder"]),
  }, request)

  return NextResponse.json({ data: row })
}

/** 软删除课时并级联标记它的句子，见 lib/soft-delete。恢复走 PATCH。 */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth
  if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })

  const { id } = await params
  const [before] = await db.select().from(lessons).where(eq(lessons.id, id)).limit(1)
  const impact = await softDeleteLesson(id)
  if (!impact) return NextResponse.json({ error: "课时不存在或已在回收站" }, { status: 404 })
  await logAdminAction(auth, {
    action: "delete",
    targetType: "lesson",
    targetId: id,
    targetLabel: before?.title ?? null,
    detail: { impact },
  }, request)
  return NextResponse.json({ data: { id, deleted: true, impact } })
}

/** 从回收站恢复课时（连同同批次的句子）。 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth
  if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })

  const { id } = await params
  const [before] = await db.select().from(lessons).where(eq(lessons.id, id)).limit(1)
  const impact = await restoreLesson(id)
  if (!impact) return NextResponse.json({ error: "课时不存在或未被删除" }, { status: 404 })
  await logAdminAction(auth, {
    action: "restore",
    targetType: "lesson",
    targetId: id,
    targetLabel: before?.title ?? null,
    detail: { impact },
  }, request)
  return NextResponse.json({ data: { id, restored: true, impact } })
}
