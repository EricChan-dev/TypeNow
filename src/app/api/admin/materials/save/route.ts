import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { sentences } from "@/lib/db/schema"
import { requireAdmin } from "@/lib/admin-auth"

interface SentenceInput {
  english: string
  chinese: string
  difficulty?: number
  words?: Array<{ english: string; chinese: string | null; phonetic: string | null; pos: string }>
  chunks?: Array<{ order: number; text: string; chinese: string }>
}

export async function POST(request: Request) {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth
  if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })

  const { lessonId, sentences: items } = await request.json() as {
    lessonId?: string
    sentences: SentenceInput[]
  }

  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: "sentences array required" }, { status: 400 })
  }

  const rows = items.map((s) => ({
    english: s.english,
    chinese: s.chinese,
    difficulty: s.difficulty ?? 1,
    lessonId: lessonId ?? null,
    wordsCount: s.english.trim().split(/\s+/).length,
    words: s.words ?? null,
    chunks: s.chunks ?? null,
  }))

  await db.insert(sentences).values(rows)

  return NextResponse.json({ data: { savedCount: rows.length } }, { status: 201 })
}
