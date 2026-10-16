import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { courseAiMeta, courses, lessons, sentences } from "@/lib/db/schema"
import { and, asc, eq, inArray } from "drizzle-orm"
import { getSession } from "@/lib/auth/session"
import { aliveCourse, aliveLesson, aliveSentence } from "@/lib/soft-delete"
import { isDuplicateKeyError } from "@/lib/db/duplicate-key"
import { extractJson, llmCall, resolveLlmEndpoint } from "@/lib/llm"
import { MAX_INTRO_LESSON_TITLES, MAX_INTRO_SAMPLE_SENTENCES, buildIntroPrompt, validateIntro } from "@/lib/course-ai"

/**
 * 课程级「AI 课程简介」（任务④）。
 *
 * ── 缓存策略 ────────────────────────────────────────────────────────────────
 *
 * 一课一行（course_ai_meta，PK=course_id），全站共享、无用户维度。命中缓存
 * 直接返回（详情页每次加载都调本接口，必须快）；未命中才走 LLM——**首次**
 * 生成要等十几秒，由前端以「AI 正在生成课程简介…」的占位承接，生成完落库，
 * 之后所有用户秒开。生成失败不落任何行（下次请求重试），接口回 502，前端
 * 收起简介区块，绝不渲染半截文本。
 *
 * ── 为什么不上会员墙 ───────────────────────────────────────────────────────
 *
 * 「免费用户仅限第一课时」约束的是**课节级** AI 分析（/api/lessons/[id]/ai）；
 * 简介是课程级导学内容，放开给所有人看更利于转化。
 */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: "请先登录" }, { status: 401 })
    if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })

    const { id } = await params
    // 与 detail 路由同一道门：课程必须活着且已发布
    const [course] = await db
      .select({ id: courses.id, title: courses.title, description: courses.description })
      .from(courses)
      .where(and(eq(courses.id, id), eq(courses.isPublished, 1), aliveCourse))
      .limit(1)
    if (!course) return NextResponse.json({ error: "课程不存在或未发布" }, { status: 404 })

    // 缓存命中：直接回（详情页每次加载都问，这条路径必须无 LLM）
    const [cached] = await db
      .select({ intro: courseAiMeta.intro, model: courseAiMeta.model })
      .from(courseAiMeta)
      .where(eq(courseAiMeta.courseId, id))
      .limit(1)
    if (cached) return NextResponse.json({ intro: cached.intro, cached: true, model: cached.model })

    // ── 组提示词素材：课节标题（按 sortOrder）+ 跨前几个课节的内容样本 ──────
    const lessonRows = await db
      .select({ id: lessons.id, title: lessons.title })
      .from(lessons)
      .where(and(eq(lessons.courseId, id), aliveLesson))
      .orderBy(asc(lessons.sortOrder))
      .limit(MAX_INTRO_LESSON_TITLES)

    let sampleSentences: string[] = []
    if (lessonRows.length > 0) {
      // 样本取自前 10 个课节：一次 inArray 查回来，再按**课程内课节顺序**
      //（不是 UUID 字典序）重排，凑满 MAX_INTRO_SAMPLE_SENTENCES 句。
      const sampleLessonIds = lessonRows.slice(0, 10).map((l) => l.id)
      const sentRows = await db
        .select({ lessonId: sentences.lessonId, english: sentences.english, sortOrder: sentences.sortOrder })
        .from(sentences)
        .where(and(inArray(sentences.lessonId, sampleLessonIds), aliveSentence))
        .orderBy(asc(sentences.lessonId), asc(sentences.sortOrder))
        .limit(200)
      const orderIndex = new Map(sampleLessonIds.map((lid, i) => [lid, i]))
      sampleSentences = sentRows
        .filter((s) => s.lessonId !== null)
        .sort(
          (a, b) =>
            (orderIndex.get(a.lessonId as string) ?? 99) - (orderIndex.get(b.lessonId as string) ?? 99) ||
            a.sortOrder - b.sortOrder
        )
        .slice(0, MAX_INTRO_SAMPLE_SENTENCES)
        .map((s) => s.english)
    }

    const prompt = buildIntroPrompt({
      title: course.title,
      description: course.description,
      lessonTitles: lessonRows.map((l) => l.title),
      sampleSentences,
    })
    const raw = await llmCall({
      systemPrompt: prompt.systemPrompt,
      userMessage: prompt.userMessage,
      // 简介是长文案生成，0.4 与 knowledge/analyze 同档：要稳定但允许行文有起伏
      temperature: 0.4,
    })
    const parsed = JSON.parse(extractJson(raw)) as Record<string, unknown>
    const intro = validateIntro(parsed.intro)
    if (!intro) {
      console.error("[courses/[id]/ai-intro GET] invalid intro payload:", raw.slice(0, 200))
      return NextResponse.json({ error: "ai_generate_failed" }, { status: 502 })
    }

    // 记录实际使用的模型（CUSTOM_LLM_* 或官方 DeepSeek），便于审计追溯
    const usedModel = resolveLlmEndpoint().model
    // 并发首建：两个用户同时触发生成时 INSERT 撞 PK——后者改读前者那行
    try {
      await db.insert(courseAiMeta).values({ courseId: id, intro, model: usedModel })
    } catch (e) {
      if (!isDuplicateKeyError(e)) throw e
      const [winner] = await db
        .select({ intro: courseAiMeta.intro, model: courseAiMeta.model })
        .from(courseAiMeta)
        .where(eq(courseAiMeta.courseId, id))
        .limit(1)
      if (winner) return NextResponse.json({ intro: winner.intro, cached: true, model: winner.model })
      throw e
    }
    return NextResponse.json({ intro, cached: false, model: usedModel })
  } catch (e) {
    console.error("[courses/[id]/ai-intro GET]", e)
    // 上游 LLM 挂了（额度/网络/5xx）按生成失败回 502（与注释契约一致），
    // 其余（我们的 bug）回 500，监控里能区分「服务商问题」和「代码问题」。
    if (e instanceof Error && e.message.startsWith("LLM API error")) {
      return NextResponse.json({ error: "ai_generate_failed" }, { status: 502 })
    }
    return NextResponse.json({ error: "server_error" }, { status: 500 })
  }
}
