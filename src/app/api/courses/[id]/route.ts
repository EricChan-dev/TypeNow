import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { courses } from "@/lib/db/schema"
import { and, eq } from "drizzle-orm"

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })

  const { id } = await params
  const [course] = await db.select().from(courses)
    .where(and(eq(courses.id, id), eq(courses.isPublished, 1)))
    .limit(1)

  if (!course) return NextResponse.json({ error: "Not found" }, { status: 404 })
  return NextResponse.json({ data: course })
}
