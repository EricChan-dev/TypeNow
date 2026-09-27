import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { restoreSentence, softDeleteSentence } from "@/lib/soft-delete"
import { sentences } from "@/lib/db/schema"
import { requireAdmin } from "@/lib/admin-auth"
import { diffAuditFields, logAdminAction, sentenceAuditLabel } from "@/lib/admin-audit"
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

  // 先读现状：差的字段要给出 from/to；顺带把不存在的 id 变成 404 而不是假审计
  const [before] = await db.select().from(sentences).where(eq(sentences.id, id)).limit(1)
  if (!before) return NextResponse.json({ error: "Not found" }, { status: 404 })

  await db.update(sentences).set({ chinese, english, wordsCount, category, difficulty, tags, lessonId, words, chunks, sortOrder, dependencyAnalysis }).where(eq(sentences.id, id))
  const [row] = await db.select().from(sentences).where(eq(sentences.id, id)).limit(1)

  await logAdminAction(auth, {
    action: "update",
    targetType: "sentence",
    targetId: id,
    targetLabel: sentenceAuditLabel(row?.chinese ?? before.chinese),
    // words / chunks 是整块 JSON，diff 出来会把日志撑得没法读；
    // 这里只关心人工可读的那几个字段（words 的变化由"编辑了这句"本身就够定位了）
    detail: diffAuditFields(before, row, [
      "chinese", "english", "wordsCount", "category", "difficulty",
      "tags", "lessonId", "sortOrder", "dependencyAnalysis",
    ]),
  }, request)

  return NextResponse.json({ data: row })
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth
  if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })

  const { id } = await params
  const [before] = await db.select().from(sentences).where(eq(sentences.id, id)).limit(1)
  // 软删除，可恢复（见 lib/soft-delete）；内部会失效句子总数缓存
  const ok = await softDeleteSentence(id)
  if (!ok) return NextResponse.json({ error: "句子不存在或已在回收站" }, { status: 404 })
  await logAdminAction(auth, {
    action: "delete",
    targetType: "sentence",
    targetId: id,
    targetLabel: sentenceAuditLabel(before?.chinese),
  }, request)
  return NextResponse.json({ data: { id, deleted: true } })
}

/** 从回收站恢复句子。 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth
  if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })

  const { id } = await params
  const [before] = await db.select().from(sentences).where(eq(sentences.id, id)).limit(1)
  const ok = await restoreSentence(id)
  if (!ok) return NextResponse.json({ error: "句子不存在或未被删除" }, { status: 404 })
  await logAdminAction(auth, {
    action: "restore",
    targetType: "sentence",
    targetId: id,
    targetLabel: sentenceAuditLabel(before?.chinese),
  }, request)
  return NextResponse.json({ data: { id, restored: true } })
}
