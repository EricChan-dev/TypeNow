import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth/session"
import { db } from "@/lib/db"
import { practiceRecords } from "@/lib/db/schema"
import { scoreForMistakes } from "@/lib/practice-score"

/**
 * 记录一次句子练习。
 *
 * practice_records 是首页周统计与学习档案的唯一数据源：
 *   /api/home/stats、/api/archive/stats 都会聚合它。
 * 在此之前没有任何代码写入该表，导致上述两个页面恒为 0。
 *
 * body: { sentenceId, mistakes?, userInput?, isReview? }
 * score 由 mistakes 按 docs/pages/04-practice.md 的 10/6/2 规则推导，
 * 客户端不直接传分数，避免被伪造。
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })

    let body: {
      sentenceId?: string
      userInput?: string | null
      mistakes?: number
      isReview?: boolean
    }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: "请求格式错误" }, { status: 400 })
    }

    const { sentenceId, userInput, mistakes = 0, isReview = false } = body
    if (!sentenceId) {
      return NextResponse.json({ error: "sentenceId required" }, { status: 400 })
    }

    const normalizedMistakes = Number.isFinite(Number(mistakes))
      ? Math.max(0, Math.trunc(Number(mistakes)))
      : 0
    const { score, grade } = scoreForMistakes(normalizedMistakes)

    await db.insert(practiceRecords).values({
      userId: session.userId,
      sentenceId,
      userInput: userInput ?? null,
      score,
      mistakes: normalizedMistakes,
      isReview: isReview ? 1 : 0,
    })

    return NextResponse.json({ success: true, score, grade })
  } catch (e) {
    console.error("[practice/record]", e)
    return NextResponse.json({ error: "记录失败" }, { status: 500 })
  }
}
