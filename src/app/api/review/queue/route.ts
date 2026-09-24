import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { reviewQueue, sentences } from "@/lib/db/schema"
import { and, eq, lte, sql } from "drizzle-orm"
import { getSession } from "@/app/actions/auth"
import { usableSentenceSql } from "@/lib/sentence-quality"
import { alignWordsWithEnglish } from "@/lib/word-align"

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })

  const now = new Date()

  // 不可用的句子不能进复习流：题干脏（chinese 无中文 / 与答案雷同）时用户看不到中文
  // 提示、题干本身就是答案；答案脏（english 是空串或只有标点）时复习页一个输入格都
  // 渲染不出来。列表与下面的 total 必须用同一条件，否则会出现
  // 「接口说有 3 条待复习，复习本点进去是空的」。
  const usable = usableSentenceSql(sentences.chinese, sentences.english)

  const rows = await db
    .select({
      reviewId: reviewQueue.id,
      sentenceId: reviewQueue.sentenceId,
      reviewCount: reviewQueue.reviewCount,
      consecutiveOk: reviewQueue.consecutiveOk,
      intervalDays: reviewQueue.intervalDays,
      english: sentences.english,
      chinese: sentences.chinese,
      words: sentences.words,
      chunks: sentences.chunks,
    })
    .from(reviewQueue)
    .innerJoin(sentences, eq(reviewQueue.sentenceId, sentences.id))
    .where(
      and(
        eq(reviewQueue.userId, session.userId),
        eq(reviewQueue.status, "pending"),
        lte(reviewQueue.nextReviewAt, now),
        usable,
      )
    )
    .orderBy(sql`${reviewQueue.nextReviewAt} ASC`)
    .limit(20)

  // words 以 english 的分词为骨架重建，保证标点与翻译一致（导入的 words 普遍缺标点）
  const items = rows.map((r) => ({ ...r, words: alignWordsWithEnglish(r.english, r.words) }))

  // Count total pending (including those not yet due)
  const [{ total }] = await db
    .select({ total: sql<number>`COUNT(*)` })
    .from(reviewQueue)
    .innerJoin(sentences, eq(reviewQueue.sentenceId, sentences.id))
    .where(
      and(
        eq(reviewQueue.userId, session.userId),
        eq(reviewQueue.status, "pending"),
        lte(reviewQueue.nextReviewAt, now),
        usable,
      )
    )

  return NextResponse.json({ items, total: Number(total) })
}
