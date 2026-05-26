import { NextResponse } from "next/server"
import { db } from "@/lib/db"
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
  await db.update(courses).set(body).where(eq(courses.id, id))
  const [row] = await db.select().from(courses).where(eq(courses.id, id)).limit(1)
  return NextResponse.json({ data: row })
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth
  if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })

  const { id } = await params
  await db.delete(courses).where(eq(courses.id, id))
  return NextResponse.json({ data: { id } })
}
