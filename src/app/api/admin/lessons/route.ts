import { randomUUID } from "crypto"
import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { lessons } from "@/lib/db/schema"
import { requireAdmin } from "@/lib/admin-auth"
import { eq, sql } from "drizzle-orm"

export async function GET(request: Request) {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth
  if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })

  const { searchParams } = new URL(request.url)
  const courseId = searchParams.get("courseId")
  const page = Number(searchParams.get("current") ?? "1")
  const pageSize = Number(searchParams.get("pageSize") ?? "50")
  const offset = (page - 1) * pageSize

  const where = courseId ? eq(lessons.courseId, courseId) : undefined

  const [rows, [{ total }]] = await Promise.all([
    db.select().from(lessons).where(where).limit(pageSize).offset(offset).orderBy(lessons.sortOrder),
    db.select({ total: sql<number>`count(*)` }).from(lessons).where(where),
  ])

  return NextResponse.json({ data: rows, total })
}

export async function POST(request: Request) {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth
  if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })

  const body = await request.json()
  const id = randomUUID()
  await db.insert(lessons).values({ ...body, id })
  const [row] = await db.select().from(lessons).where(eq(lessons.id, id)).limit(1)
  return NextResponse.json({ data: row }, { status: 201 })
}
