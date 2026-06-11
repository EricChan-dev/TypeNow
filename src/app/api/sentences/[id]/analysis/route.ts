import { NextResponse } from "next/server"
import { createHash } from "crypto"
import { db } from "@/lib/db"
import { sentences, sentenceKnowledge } from "@/lib/db/schema"
import { eq } from "drizzle-orm"
import { getSession } from "@/lib/auth/session"

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 })
  }

  if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })

  const { id } = await params
  const [sentence] = await db
    .select({ english: sentences.english })
    .from(sentences)
    .where(eq(sentences.id, id))
    .limit(1)

  if (!sentence) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const sentenceHash = createHash("sha256").update((sentence.english ?? "").trim()).digest("hex")

  const [cached] = await db
    .select({ data: sentenceKnowledge.data })
    .from(sentenceKnowledge)
    .where(eq(sentenceKnowledge.sentenceHash, sentenceHash))
    .limit(1)

  if (!cached) return NextResponse.json({ data: null })

  return NextResponse.json({ data: cached.data })
}
