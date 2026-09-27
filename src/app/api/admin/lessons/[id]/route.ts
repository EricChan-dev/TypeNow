import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { restoreLesson, softDeleteLesson } from "@/lib/soft-delete"
import { lessons } from "@/lib/db/schema"
import { requireAdmin } from "@/lib/admin-auth"
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
  await db.update(lessons).set({ courseId, title, summary, sortOrder }).where(eq(lessons.id, id))
  const [row] = await db.select().from(lessons).where(eq(lessons.id, id)).limit(1)
  return NextResponse.json({ data: row })
}

/** 软删除课时并级联标记它的句子，见 lib/soft-delete。恢复走 PATCH。 */
export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth
  if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })

  const { id } = await params
  const impact = await softDeleteLesson(id)
  if (!impact) return NextResponse.json({ error: "课时不存在或已在回收站" }, { status: 404 })
  return NextResponse.json({ data: { id, deleted: true, impact } })
}

/** 从回收站恢复课时（连同同批次的句子）。 */
export async function PATCH(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth
  if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })

  const { id } = await params
  const impact = await restoreLesson(id)
  if (!impact) return NextResponse.json({ error: "课时不存在或未被删除" }, { status: 404 })
  return NextResponse.json({ data: { id, restored: true, impact } })
}
