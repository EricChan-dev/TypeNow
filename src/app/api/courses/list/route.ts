import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { courses } from "@/lib/db/schema"
import { eq, sql, desc } from "drizzle-orm"

export async function GET(request: Request) {
  if (!db) return NextResponse.json({ data: [], total: 0 })

  const { searchParams } = new URL(request.url)
  const page = Number(searchParams.get("current") ?? "1")
  const pageSize = Number(searchParams.get("pageSize") ?? "100")
  const offset = (page - 1) * pageSize

  const [rows, [{ total }]] = await Promise.all([
    db.select().from(courses)
      .where(eq(courses.isPublished, 1))
      .limit(pageSize)
      .offset(offset)
      .orderBy(desc(courses.learnerCount), courses.createdAt),
    db.select({ total: sql<number>`count(*)` }).from(courses).where(eq(courses.isPublished, 1)),
  ])

  return NextResponse.json({ data: rows, total })
}
