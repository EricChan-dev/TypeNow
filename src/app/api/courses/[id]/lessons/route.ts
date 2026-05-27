import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { lessons } from "@/lib/db/schema"
import { eq, asc } from "drizzle-orm"

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })

  const { id } = await params
  const data = await db.select().from(lessons)
    .where(eq(lessons.courseId, id))
    .orderBy(asc(lessons.sortOrder))

  return NextResponse.json({ data })
}
