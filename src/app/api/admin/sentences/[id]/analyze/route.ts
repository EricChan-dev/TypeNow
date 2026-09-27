import { NextResponse } from "next/server"
import { createHash } from "crypto"
import { db } from "@/lib/db"
import { aliveSentence } from "@/lib/soft-delete"
import { sentences, sentenceKnowledge } from "@/lib/db/schema"
import { requireAdmin } from "@/lib/admin-auth"
import { logAdminAction, sentenceAuditLabel } from "@/lib/admin-audit"
import { checkAdminAiQuota, quotaExceededBody } from "@/lib/admin-ai-quota"
import { and, eq } from "drizzle-orm"
import { analyzeSentence } from "@/lib/llm"

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth
  // AI 调用会计费且这些接口没有其它成本闸门，先检查按账号的配额（见 lib/admin-ai-quota）
  const quota = checkAdminAiQuota("sentence-analyze", auth.userId)
  if (!quota.allowed) {
    return NextResponse.json(quotaExceededBody(quota), { status: 429 })
  }
  if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })

  const { id } = await params
  const force = new URL(req.url).searchParams.get("force") === "1"

  const [sentence] = await db.select().from(sentences).where(and(eq(sentences.id, id), aliveSentence)).limit(1)
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

  // 只在**真的调用了 AI** 时记日志（上面命中缓存就 return 了）：
  // 命中缓存的重试不是一次付费动作，记进去只会让"谁花了钱"这个问题更难回答。
  await logAdminAction(auth, {
    action: "analyze",
    targetType: "sentence",
    targetId: id,
    targetLabel: sentenceAuditLabel(sentence.chinese),
    detail: { force, cached: false },
  }, req)

  return NextResponse.json({ data: analysis, cached: false })
}
