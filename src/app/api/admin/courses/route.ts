import { randomUUID } from "crypto"
import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { courses } from "@/lib/db/schema"
import { requireAdmin } from "@/lib/admin-auth"
import { eq, sql } from "drizzle-orm"

export async function GET(request: Request) {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth
  if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })

  const { searchParams } = new URL(request.url)
  const page = Number(searchParams.get("current") ?? "1")
  const pageSize = Number(searchParams.get("pageSize") ?? "20")
  const offset = (page - 1) * pageSize

  const [rows, [{ total }]] = await Promise.all([
    db.select().from(courses).limit(pageSize).offset(offset).orderBy(courses.createdAt),
    db.select({ total: sql<number>`count(*)` }).from(courses),
  ])

  return NextResponse.json({ data: rows, total })
}

export async function POST(request: Request) {
  try {
    const auth = await requireAdmin()
    if (auth instanceof NextResponse) return auth
    if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let body: any
    try { body = await request.json() } catch { return NextResponse.json({ error: "请求格式错误" }, { status: 400 }) }
    const { title, description, coverUrl, source, sourceName, sourceAvatar, categoryKey, subCategoryKey, isPublished } = body
    const id = randomUUID()
    await db.insert(courses).values({ id, title, description, coverUrl, source, sourceName, sourceAvatar, categoryKey, subCategoryKey, isPublished, createdBy: auth.userId })
    const [row] = await db.select().from(courses).where(eq(courses.id, id)).limit(1)
    return NextResponse.json({ data: row }, { status: 201 })
  } catch (e) {
    console.error("[admin/courses POST]", e)
    return NextResponse.json({ error: "创建课程失败" }, { status: 500 })
  }
}
