import { randomUUID } from "crypto"
import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { lessons } from "@/lib/db/schema"
import { requireAdmin } from "@/lib/admin-auth"
import { parsePagination } from "@/lib/pagination"
import { and, eq, or, like, sql, type SQL } from "drizzle-orm"

export async function GET(request: Request) {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth
  if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })

  const { searchParams } = new URL(request.url)
  const courseId = searchParams.get("courseId")
  // 课时按课内顺序排，保持 asc(sortOrder)；只收敛分页参数。
  const { pageSize, offset } = parsePagination(searchParams, 50)

  const q = (searchParams.get("q") ?? "").trim().slice(0, 64)

  const conds: SQL[] = []
  if (courseId) conds.push(eq(lessons.courseId, courseId))
  if (q) conds.push(or(like(lessons.title, `%${q}%`), like(lessons.summary, `%${q}%`))!)
  const where: SQL | undefined =
    conds.length === 0 ? undefined : conds.length === 1 ? conds[0] : and(...conds)

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
  const { courseId, title, summary, sortOrder } = body
  const id = randomUUID()
  await db.insert(lessons).values({ id, courseId, title, summary, sortOrder })
  const [row] = await db.select().from(lessons).where(eq(lessons.id, id)).limit(1)
  return NextResponse.json({ data: row }, { status: 201 })
}
