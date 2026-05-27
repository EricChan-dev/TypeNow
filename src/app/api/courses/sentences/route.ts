import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { sentences } from "@/lib/db/schema"
import { eq, asc } from "drizzle-orm"

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const lessonId = searchParams.get("lessonId")

  if (!lessonId) {
    return NextResponse.json({ error: "缺少 lessonId 参数" }, { status: 400 })
  }

  if (!db) return NextResponse.json({ sentences: [] })

  const data = await db
    .select()
    .from(sentences)
    .where(eq(sentences.lessonId, lessonId))
    .orderBy(asc(sentences.sortOrder))

  return NextResponse.json({ sentences: data })
}
