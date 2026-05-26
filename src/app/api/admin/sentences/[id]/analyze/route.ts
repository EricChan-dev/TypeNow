import { NextResponse } from "next/server"
import { createHash } from "crypto"
import { db } from "@/lib/db"
import { sentences, sentenceKnowledge } from "@/lib/db/schema"
import { requireAdmin } from "@/lib/admin-auth"
import { eq } from "drizzle-orm"
import { analyzeSentence } from "@/lib/llm"

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth
  if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })

  const { id } = await params
  const force = new URL(req.url).searchParams.get("force") === "1"

  const [sentence] = await db.select().from(sentences).where(eq(sentences.id, id)).limit(1)
  if (!sentence) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const english = sentence.english ?? ""
  const sentenceHash = createHash("sha256").update(english.trim()).digest("hex")

  // Return cached if available (skip when force=1)
  if (!force) {
    const [cached] = await db
      .select({ data: sentenceKnowledge.data })
      .from(sentenceKnowledge)
      .where(eq(sentenceKnowledge.sentenceHash, sentenceHash))
      .limit(1)

    if (cached) return NextResponse.json({ data: cached.data, cached: true })
  }

  // Call AI
  const analysis = await analyzeSentence(english)
  if (!analysis) return NextResponse.json({ error: "AI 分析失败" }, { status: 500 })

  // Persist to sentence_knowledge
  await db
    .insert(sentenceKnowledge)
    .values({ sentenceHash, sentenceText: english.trim(), data: analysis })
    .onDuplicateKeyUpdate({ set: { data: analysis } })

  return NextResponse.json({ data: analysis, cached: false })
}
