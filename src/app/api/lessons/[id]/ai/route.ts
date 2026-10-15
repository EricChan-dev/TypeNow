import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { courses, lessonAiInsights, lessons, sentences, users } from "@/lib/db/schema"
import { and, asc, eq } from "drizzle-orm"
import { getSession } from "@/lib/auth/session"
import { aliveCourse, aliveLesson, aliveSentence } from "@/lib/soft-delete"
import { isDuplicateKeyError } from "@/lib/db/duplicate-key"
import { checkAndExpirePro } from "@/lib/subscription"
import { extractJson, llmCall, resolveLlmEndpoint } from "@/lib/llm"
import {
  MAX_ANALYZE_SENTENCES,
  buildLessonAiPrompt,
  validateComplexity,
  validateGrammar,
} from "@/lib/course-ai"

/**
 * 课节级「AI 语法点 + 句子复杂度」（任务④）。
 *
 * ── 与派生接口的分工 ────────────────────────────────────────────────────────
 *
 * 核心词汇/短语走 /api/lessons/[id]/insight（sentences JSON 现算，毫秒级）；
 * 这里是 LLM 产物：单次调用数秒、花真金白银，所以落 lesson_ai_insights
 * （PK=lesson_id）缓存，一课节只生成一次，之后全部命中缓存秒回。前端展开
 * 课节时**并行**发两个请求，本接口慢不拖累词汇/短语先亮出来。
 *
 * ── 会员门（免费用户仅限第一课时）─────────────────────────────────────────
 *
 * 服务端强校验（与前端 UI 锁双保险，防直接打接口）：免费用户只能读**本课程
 * 第一节课节**（sortOrder 最小的活课节）的 AI 分析，其余回 403 pro_required。
 * 缓存里有也不放开——门在读取侧，不在生成侧。派生数据不受此限。
 */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: "请先登录" }, { status: 401 })
    if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })

    const { id } = await params
    // 与 insight 路由同一道门：课节必须活着且属于已发布课程；顺带取标题与归属
    const [lesson] = await db
      .select({ id: lessons.id, title: lessons.title, courseId: lessons.courseId })
      .from(lessons)
      .innerJoin(courses, eq(lessons.courseId, courses.id))
      .where(and(eq(lessons.id, id), eq(courses.isPublished, 1), aliveCourse, aliveLesson))
      .limit(1)
    if (!lesson) return NextResponse.json({ error: "课时不存在或未发布" }, { status: 404 })

    // ── 会员态：与 detail 路由同一套（先过期结算再读）──────────────────────
    const [revoked, viewerRow] = await Promise.all([
      checkAndExpirePro(session.userId),
      db.select({ isPro: users.isPro }).from(users).where(eq(users.id, session.userId)).limit(1),
    ])
    const isPro = revoked ? false : !!viewerRow[0]?.isPro
    if (!isPro) {
      const [first] = await db
        .select({ id: lessons.id })
        .from(lessons)
        .where(and(eq(lessons.courseId, lesson.courseId), aliveLesson))
        .orderBy(asc(lessons.sortOrder))
        .limit(1)
      if (!first || first.id !== lesson.id) {
        return NextResponse.json({ error: "pro_required" }, { status: 403 })
      }
    }

    // ── 缓存（一课节只生成一次；两个块都有值才算命中）────────────────────
    const [cached] = await db
      .select({ grammar: lessonAiInsights.grammar, complexity: lessonAiInsights.complexity, model: lessonAiInsights.model })
      .from(lessonAiInsights)
      .where(eq(lessonAiInsights.lessonId, id))
      .limit(1)
    if (cached && (cached.grammar || cached.complexity)) {
      return NextResponse.json({ grammar: cached.grammar, complexity: cached.complexity, cached: true })
    }

    // ── 生成：句子按 sortOrder 截前 MAX_ANALYZE_SENTENCES 句 ──────────────
    const sentRows = await db
      .select({ english: sentences.english, chinese: sentences.chinese })
      .from(sentences)
      .where(and(eq(sentences.lessonId, id), aliveSentence))
      .orderBy(asc(sentences.sortOrder))
      .limit(MAX_ANALYZE_SENTENCES)
    if (sentRows.length === 0) {
      return NextResponse.json({ error: "课时没有句子" }, { status: 404 })
    }

    const prompt = buildLessonAiPrompt(lesson.title, sentRows)
    const raw = await llmCall({
      systemPrompt: prompt.systemPrompt,
      userMessage: prompt.userMessage,
      // 分析类任务要稳定：0.3，比 knowledge/analyze 的 0.5 再收一档
      temperature: 0.3,
    })
    const parsed = JSON.parse(extractJson(raw)) as Record<string, unknown>
    const grammar = validateGrammar(parsed.grammar)
    const complexity = validateComplexity(parsed.complexity)
    if (!grammar && !complexity) {
      console.error("[lessons/[id]/ai GET] invalid ai payload:", raw.slice(0, 200))
      return NextResponse.json({ error: "ai_generate_failed" }, { status: 502 })
    }

    // 并发首建：撞 PK 说明别人刚生成完，改读他那行（重试兜底：缓存读写再miss就报错）
    try {
      // 记录实际使用的模型（CUSTOM_LLM_* 或官方 DeepSeek），便于审计追溯
      await db.insert(lessonAiInsights).values({ lessonId: id, grammar, complexity, model: resolveLlmEndpoint().model })
    } catch (e) {
      if (!isDuplicateKeyError(e)) throw e
      const [winner] = await db
        .select({ grammar: lessonAiInsights.grammar, complexity: lessonAiInsights.complexity, model: lessonAiInsights.model })
        .from(lessonAiInsights)
        .where(eq(lessonAiInsights.lessonId, id))
        .limit(1)
      if (winner) {
        return NextResponse.json({ grammar: winner.grammar, complexity: winner.complexity, cached: true })
      }
      throw e
    }
    return NextResponse.json({ grammar, complexity, cached: false })
  } catch (e) {
    console.error("[lessons/[id]/ai GET]", e)
    // 上游 LLM 挂了（额度/网络/5xx）按生成失败回 502；其余（我们的 bug）回 500。
    if (e instanceof Error && e.message.startsWith("LLM API error")) {
      return NextResponse.json({ error: "ai_generate_failed" }, { status: 502 })
    }
    return NextResponse.json({ error: "server_error" }, { status: 500 })
  }
}
