import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { courses } from "@/lib/db/schema"
import { eq, and, like, sql, desc } from "drizzle-orm"
import type { SortMode } from "@/types/course"

export async function GET(request: Request) {
  if (!db) return NextResponse.json({ data: [], total: 0 })

  const { searchParams } = new URL(request.url)
  const page = Number(searchParams.get("current") ?? "1")
  const pageSize = Number(searchParams.get("pageSize") ?? "20")
  const offset = (page - 1) * pageSize
  const categoryKey = searchParams.get("categoryKey")
  const subCategoryKey = searchParams.get("subCategoryKey")
  const search = searchParams.get("search")?.trim()
  const sortMode = (searchParams.get("sortMode") ?? "latest") as SortMode

  // Build WHERE conditions
  const conditions = [eq(courses.isPublished, 1)]
  if (categoryKey && categoryKey !== "all") conditions.push(eq(courses.categoryKey, categoryKey))
  if (subCategoryKey) conditions.push(eq(courses.subCategoryKey, subCategoryKey))
  if (search) {
    conditions.push(
      like(courses.title, `%${search}%`)
    )
  }
  const where = and(...conditions)

  // Build ORDER BY
  let orderBy
  switch (sortMode) {
    case "most_used":
      orderBy = desc(courses.usageCount)
      break
    case "name":
      orderBy = courses.title
      break
    case "latest":
    default:
      orderBy = desc(courses.createdAt)
      break
  }

  const [rows, [{ total }]] = await Promise.all([
    db.select().from(courses)
      .where(where)
      .limit(pageSize)
      .offset(offset)
      .orderBy(orderBy),
    db.select({ total: sql<number>`count(*)` }).from(courses).where(where),
  ])

  return NextResponse.json({ data: rows, total })
}
