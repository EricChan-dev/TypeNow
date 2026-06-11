import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { sentences } from "@/lib/db/schema"
import { requireAdmin } from "@/lib/admin-auth"
import { eq } from "drizzle-orm"

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth
  if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })

  const { id } = await params
  const [row] = await db.select().from(sentences).where(eq(sentences.id, id)).limit(1)
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 })
  return NextResponse.json({ data: row })
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth
  if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })

  const { id } = await params
  const body = await request.json()
  const { chinese, english, wordsCount, category, difficulty, tags, lessonId, words, chunks, sortOrder, dependencyAnalysis } = body
  await db.update(sentences).set({ chinese, english, wordsCount, category, difficulty, tags, lessonId, words, chunks, sortOrder, dependencyAnalysis }).where(eq(sentences.id, id))
  const [row] = await db.select().from(sentences).where(eq(sentences.id, id)).limit(1)
  return NextResponse.json({ data: row })
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth
  if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })

  const { id } = await params
  await db.delete(sentences).where(eq(sentences.id, id))
  return NextResponse.json({ data: { id } })
}
