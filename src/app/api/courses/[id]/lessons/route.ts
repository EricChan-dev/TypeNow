import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { courses, lessons } from "@/lib/db/schema"
import { and, eq, asc } from "drizzle-orm"

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })

  const { id } = await params
  // 公开接口：课程未发布时不得泄露其课时，与 /api/courses/[id] 保持一致返回 404
  const [course] = await db.select({ id: courses.id }).from(courses)
    .where(and(eq(courses.id, id), eq(courses.isPublished, 1)))
    .limit(1)
  if (!course) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const data = await db.select().from(lessons)
    .where(eq(lessons.courseId, id))
    .orderBy(asc(lessons.sortOrder))

  return NextResponse.json({ data })
}
