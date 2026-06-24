import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { sentences } from "@/lib/db/schema"
import { eq, asc } from "drizzle-orm"
import { getSession } from "@/lib/auth/session"

const TOKEN_RE = /[a-zA-Z\d'-]+|[.,!?;:'"()…—]/g

/** 从英文文本生成基础 Word 数组（当 words 为 null 时的 fallback） */
function textToWords(text: string) {
  const tokens = text.match(TOKEN_RE) ?? []
  return tokens.map((t) => ({
    english: t,
    chinese: null as string | null,
    phonetic: null as string | null,
    pos: /^[a-zA-Z\d'-]+$/.test(t) ? "词" : "标点",
  }))
}

export async function GET(request: Request) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: "请先登录" }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const lessonId = searchParams.get("lessonId")
    if (!lessonId) return NextResponse.json({ error: "缺少 lessonId 参数" }, { status: 400 })
    if (!db) return NextResponse.json({ sentences: [] })

    const data = await db.select().from(sentences).where(eq(sentences.lessonId, lessonId)).orderBy(asc(sentences.sortOrder))

    const normalized = data.map((s) => ({
      ...s,
      words: (s.words as Array<Record<string, unknown>> | null)?.length
        ? s.words
        : textToWords(s.english ?? ""),
    }))

    return NextResponse.json({ sentences: normalized })
  } catch (e) {
    console.error("[courses/sentences]", e)
    return NextResponse.json({ error: "加载句子失败" }, { status: 500 })
  }
}
