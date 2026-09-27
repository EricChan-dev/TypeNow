import { randomUUID } from "crypto"
import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { sentences } from "@/lib/db/schema"
import { requireAdmin } from "@/lib/admin-auth"
import { parsePagination } from "@/lib/pagination"
import { eq, like, or, and, sql, asc, type SQL } from "drizzle-orm"

export async function GET(request: Request) {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth
  if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })

  const { searchParams } = new URL(request.url)
  // 句子列表的排序是「课内顺序」，不能改成倒序——只收敛分页参数。
  const { pageSize, offset } = parsePagination(searchParams)
  // 通用搜索词：中英文都搜。
  // 原先这里把 chinese / english 两个参数读进同一个变量，却**只**搜 chinese ——
  // 于是 ?english=xxx 会静默去搜中文列，返回一堆无关结果。已修正为两者都搜。
  const search = searchParams.get("q") ?? searchParams.get("chinese") ?? searchParams.get("english") ?? ""
  const lessonId = searchParams.get("lessonId")

  const conditions: SQL[] = []
  if (search) {
    conditions.push(
      or(like(sentences.chinese, `%${search}%`), like(sentences.english, `%${search}%`))!,
    )
  }
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
