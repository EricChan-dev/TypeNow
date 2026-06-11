import { randomUUID } from "crypto"
import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { sentences } from "@/lib/db/schema"
import { requireAdmin } from "@/lib/admin-auth"
import { eq, like, and, sql, asc } from "drizzle-orm"

export async function GET(request: Request) {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth
  if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })

  const { searchParams } = new URL(request.url)
  const page = Number(searchParams.get("current") ?? "1")
  const pageSize = Number(searchParams.get("pageSize") ?? "20")
  const search = searchParams.get("chinese") ?? searchParams.get("english") ?? ""
  const lessonId = searchParams.get("lessonId")

  const offset = (page - 1) * pageSize
  const conditions = []
  if (search) conditions.push(like(sentences.chinese, `%${search}%`))
  if (lessonId) conditions.push(eq(sentences.lessonId, lessonId))
  const where = conditions.length > 0 ? (conditions.length === 1 ? conditions[0] : and(...conditions)) : undefined

  const [rows, [{ total }]] = await Promise.all([
    db.select().from(sentences).where(where).limit(pageSize).offset(offset).orderBy(asc(sentences.sortOrder), asc(sentences.createdAt)),
    db.select({ total: sql<number>`count(*)` }).from(sentences).where(where),
  ])

  return NextResponse.json({ data: rows, total })
}

export async function POST(request: Request) {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth
  if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })

  const body = await request.json()
  const { chinese, english, wordsCount, category, difficulty, tags, lessonId, words, chunks, sortOrder, dependencyAnalysis } = body
  const id = randomUUID()
  await db.insert(sentences).values({ id, chinese, english, wordsCount, category, difficulty, tags, lessonId, words, chunks, sortOrder, dependencyAnalysis })
  const [row] = await db.select().from(sentences).where(eq(sentences.id, id)).limit(1)
  return NextResponse.json({ data: row }, { status: 201 })
}
