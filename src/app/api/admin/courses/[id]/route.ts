import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { restoreCourse, softDeleteCourse } from "@/lib/soft-delete"
import { courses, lessons } from "@/lib/db/schema"
import { requireAdmin } from "@/lib/admin-auth"
import { eq } from "drizzle-orm"

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth
  if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })

  const { id } = await params
  const [row] = await db.select().from(courses).where(eq(courses.id, id)).limit(1)
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const courseLessons = await db
    .select()
    .from(lessons)
    .where(eq(lessons.courseId, id))
    .orderBy(lessons.sortOrder)

  return NextResponse.json({ data: { ...row, lessons: courseLessons } })
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth
  if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })

  const { id } = await params
  const body = await request.json()
  const { title, description, coverUrl, source, sourceName, sourceAvatar, categoryKey, subCategoryKey, isPublished } = body
  await db.update(courses).set({ title, description, coverUrl, source, sourceName, sourceAvatar, categoryKey, subCategoryKey, isPublished }).where(eq(courses.id, id))
  const [row] = await db.select().from(courses).where(eq(courses.id, id)).limit(1)
  return NextResponse.json({ data: row })
}

/**
 * 软删除课程（**级联**标记它的课时与句子，见 lib/soft-delete）。
 *
 * 原来是 `DELETE FROM courses WHERE id = ?` 的硬删除，而库里没有外键 ——
 * 一门课程会留下最多 16,891 条孤儿课时。现在可恢复，恢复走 PATCH。
 * 响应里回带影响面，前端可以据此提示"已移入回收站（含 N 课时 / M 句子）"。
 */
export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth
  if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })

  const { id } = await params
  const impact = await softDeleteCourse(id)
  if (!impact) {
    // 不存在或本来就在回收站里：明确区分，避免前端以为"删成功了"
    return NextResponse.json({ error: "课程不存在或已在回收站" }, { status: 404 })
  }
  return NextResponse.json({ data: { id, deleted: true, impact } })
}

/** 从回收站恢复课程（连同同批次的课时与句子）。 */
export async function PATCH(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth
  if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })

  const { id } = await params
  const impact = await restoreCourse(id)
  if (!impact) return NextResponse.json({ error: "课程不存在或未被删除" }, { status: 404 })
  return NextResponse.json({ data: { id, restored: true, impact } })
}
