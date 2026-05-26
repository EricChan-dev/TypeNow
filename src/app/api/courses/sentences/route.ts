import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { sentences } from "@/lib/db/schema"
import { eq } from "drizzle-orm"
import { getSession } from "@/lib/auth/session"
import { getMockSentencesByLesson } from "@/lib/mock-data/sentences"

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const lessonId = searchParams.get("lessonId")

  if (!lessonId) {
    return NextResponse.json({ error: "缺少 lessonId 参数" }, { status: 400 })
  }

  // Try database first
  if (db) {
    try {
      const session = await getSession()
      if (!session) return NextResponse.json({ error: "请先登录" }, { status: 401 })

      const data = await db
        .select()
        .from(sentences)
        .where(eq(sentences.lessonId, lessonId))
        .orderBy(sentences.id)

      if (data.length > 0) {
        return NextResponse.json({ sentences: data })
      }
    } catch { /* fall through to mock */ }
  }

  // Fallback to mock data
  const mockSentences = getMockSentencesByLesson(lessonId)
  return NextResponse.json({ sentences: mockSentences })
}
