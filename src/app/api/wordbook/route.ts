import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth/session"
import { db } from "@/lib/db"
import { wordbookItems, wordDictionaryCache } from "@/lib/db/schema"
import { and, desc, eq, sql } from "drizzle-orm"

export async function GET(request: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })

  const page = Math.max(1, Number(request.nextUrl.searchParams.get("page") ?? "1"))
  const size = Math.min(100, Math.max(1, Number(request.nextUrl.searchParams.get("size") ?? "50")))
  const offset = (page - 1) * size

  const rows = await db
    .select({
      id: wordbookItems.id,
      word: wordbookItems.word,
      sourceSentenceId: wordbookItems.sourceSentenceId,
      addedAt: wordbookItems.createdAt,
      phonetic: wordDictionaryCache.phonetic,
      phoneticUk: wordDictionaryCache.phoneticUk,
      translations: wordDictionaryCache.translations,
      pos: wordDictionaryCache.pos,
      synonyms: wordDictionaryCache.synonyms,
      examples: wordDictionaryCache.examples,
    })
    .from(wordbookItems)
    .leftJoin(wordDictionaryCache, eq(wordDictionaryCache.word, wordbookItems.word))
    .where(eq(wordbookItems.userId, session.userId))
    .orderBy(desc(wordbookItems.createdAt))
    .limit(size)
    .offset(offset)

  const [{ total }] = await db
    .select({ total: sql<number>`COUNT(*)` })
    .from(wordbookItems)
    .where(eq(wordbookItems.userId, session.userId))

  return NextResponse.json({ items: rows, total: Number(total ?? 0), page, size })
}

export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })

  const body = await request.json().catch(() => ({})) as { word?: string; sourceSentenceId?: string }
  const word = (body.word ?? "").trim().toLowerCase()
  if (!word || word.length > 64) {
    return NextResponse.json({ error: "invalid_word" }, { status: 400 })
  }

  await db
    .insert(wordbookItems)
    .values({
      userId: session.userId,
      word,
      sourceSentenceId: body.sourceSentenceId ?? null,
    })
    .onDuplicateKeyUpdate({ set: { sourceSentenceId: body.sourceSentenceId ?? null } })

  return NextResponse.json({ ok: true, word })
}

export async function DELETE(request: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })

  const word = (request.nextUrl.searchParams.get("word") ?? "").trim().toLowerCase()
  if (!word) return NextResponse.json({ error: "invalid_word" }, { status: 400 })

  await db
    .delete(wordbookItems)
    .where(and(eq(wordbookItems.userId, session.userId), eq(wordbookItems.word, word)))

  return NextResponse.json({ ok: true })
}
