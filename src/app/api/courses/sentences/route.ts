import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { courses, lessons, sentences, users } from "@/lib/db/schema"
import { and, eq, asc, type SQL } from "drizzle-orm"
import { getSession } from "@/lib/auth/session"
import { checkAndExpirePro } from "@/lib/subscription"
import { typeableAnswerSql, usableSentenceSql } from "@/lib/sentence-quality"
import { alignWordsWithEnglish } from "@/lib/word-align"
import { sliceForTrial } from "@/lib/free-trial"

export async function GET(request: Request) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: "请先登录" }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const lessonId = searchParams.get("lessonId")
    if (!lessonId) return NextResponse.json({ error: "缺少 lessonId 参数" }, { status: 400 })
    if (!db) return NextResponse.json({ sentences: [] })

    // 会员校验：句子正文就是付费内容本身。此前这里只校验登录，页面层
    // (home/learn/[courseId]/page.tsx) 的跳转是唯一防线，任何免费账号直接 curl
    // 这个接口就能把整库句子拖走，而且这里也不该区分「课时是否存在」。
    // 现在非会员不再被直接拒绝，而是只下发前 FREE_TRIAL_SENTENCES 句（见下方截断），
    // 因此「整库拖走」这条防线仍然成立——只是放行了每课开头少量内容。
    const revoked = await checkAndExpirePro(session.userId)
    const [viewer] = await db
      .select({ isPro: users.isPro })
      .from(users)
      .where(eq(users.id, session.userId))
      .limit(1)
    const isPro = revoked ? false : !!viewer?.isPro

    // 只返回已发布课程下的句子，避免未发布内容泄露
    const [lesson] = await db
      .select({ id: lessons.id })
      .from(lessons)
      .innerJoin(courses, eq(lessons.courseId, courses.id))
      .where(and(eq(lessons.id, lessonId), eq(courses.isPublished, 1)))
      .limit(1)
    if (!lesson) return NextResponse.json({ error: "课时不存在或未发布" }, { status: 404 })

    // 不可用的句子不进练习（线上题干脏 1,674 条 + 答案脏 160 条）：
    //   题干脏 —— chinese 无中文 / 与答案雷同，用户看到的提示就是答案本身；
    //   答案脏 —— english 是空串或只有标点，练习页渲染不出任何输入格，是个死画面。
    // （闭包里必须用下面这个已收窄的非空别名，直接用 db 会丢掉 null 检查。）
    const database = db
    const forLesson = (where: SQL<unknown>) =>
      database
        .select()
        .from(sentences)
        .where(and(eq(sentences.lessonId, lessonId), where))
        .orderBy(asc(sentences.sortOrder))

    let data = await forLesson(usableSentenceSql(sentences.chinese, sentences.english))

    // 兜底：整节课的题干都「不可用」时，只放宽题干这一条，看能不能凑出一节课来。
    // 线上确实存在这种课时，且它是**正常内容**，只是不符合「中文题干」这个假设：
    //   26字母绘本版（幼儿启蒙英语）—— a/a b/b … z/z，字母本身就是题干（答案可敲）。
    // 这种课时的 `a`/`a` 与用户抱怨的 `I`/`I` 在数据上无法区分（都是单字符且相等），
    // 所以只能按「整节课」兜底，而不是放宽行级判定。
    // 注意：答案是空的那一条**不**放宽 —— 那种句子本来就没法练，放出来只会让用户
    // 卡在一个没有任何输入格的句子上。宁可返回空，由前端给出「本课暂无可练习内容」。
    if (data.length === 0) {
      data = await forLesson(typeableAnswerSql(sentences.english))
    }

    // 非会员只下发前 N 句试学（N = FREE_TRIAL_SENTENCES）。截断时把 limit/truncated
    // 一并告知前端，由前端在练完这几句后展示付费引导，而不是让用户以为「本课就这 3 句」。
    const { visible, trial } = sliceForTrial(data, isPro)

    // words 一律以 english 的分词为骨架重建：库里导入的 words 普遍缺标点，
    // 直接下发会让练习页那行的标点与翻译对不上（线上 40% 的句子如此）。
    const normalized = visible.map((s) => ({
      ...s,
      words: alignWordsWithEnglish(s.english, s.words),
    }))

    return NextResponse.json({ sentences: normalized, trial })
  } catch (e) {
    console.error("[courses/sentences]", e)
    return NextResponse.json({ error: "加载句子失败" }, { status: 500 })
  }
}
