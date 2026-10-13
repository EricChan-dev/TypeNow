import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { courses, lessons } from "@/lib/db/schema"
import { and, eq, sql } from "drizzle-orm"
import { getSession } from "@/lib/auth/session"
import { aliveCourse, aliveLesson } from "@/lib/soft-delete"
import { selectPhrases, selectVocab, type VocabRow } from "@/lib/lesson-insight"

/**
 * 单课节的「学习要点」：核心词汇 + 核心短语。
 *
 * ── 为什么是懒加载的独立接口 ─────────────────────────────────────────────────
 *
 * 词汇/短语是从 sentences 的 JSON 列（words / chunks / dependency_analysis）
 * 用 JSON_TABLE 现场聚合的，实测单课节 ~43ms、整门 26 课的课 ~195ms，
 * 而生产库有 596 课节的课程——全量随详情页下发既慢又绝大多数用不上
 * （用户通常只展开一两个课节）。所以详情接口只给课节骨架，
 * 展开哪个课节才请求哪个。
 *
 * ── 数据形态 ────────────────────────────────────────────────────────────────
 *
 * 参考站的四块（词汇/短语/语法点/复杂度）是课节级 AI 分析产物，我们库里
 * 没有对应列。按用户决议（m20696）：词汇、短语从已有 JSON 派生，
 * 语法点、句子复杂度返回 null 占位（前端渲染「暂未生成」），不造假数据。
 *
 * 派生优先级：
 * · 词汇 —— sentences.words（覆盖 72.5%），词频 + 文档数排序，
 *   过滤虚词/短词在 lib/lesson-insight 的 selectVocab（有单测）。
 * · 短语 —— 优先 sentences.chunks（覆盖仅 5% 但是意群切分，质量高）；
 *   没有 chunks 数据时退回 dependency_analysis.nodes[].phrase
 *   （覆盖 57%，质量参差，靠 selectPhrases 的清洗规则挡脏串）。
 */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: "请先登录" }, { status: 401 })
    if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })

    const { id } = await params
    // 与 /api/courses/sentences 同一道门：课节必须活着且属于已发布课程
    const [lesson] = await db
      .select({ id: lessons.id })
      .from(lessons)
      .innerJoin(courses, eq(lessons.courseId, courses.id))
      .where(and(eq(lessons.id, id), eq(courses.isPublished, 1), aliveCourse, aliveLesson))
      .limit(1)
    if (!lesson) return NextResponse.json({ error: "课时不存在或未发布" }, { status: 404 })

    // ── 词汇：JSON_TABLE 摊平 words，按 (词, 词性) 聚合 ─────────────────────
    // docs = 出现在几个句子里。selectVocab 先按 docs 再按 count 排——
    // 一词在单句里刷 8 次（歌词课）不如分布在 5 句里能代表这一课。
    // 软删除过滤用字面量 s.deleted_at IS NULL 而不是 aliveSentence 片段：
    // 片段渲染成限定名 `sentences`.`deleted_at`，而这里的表别名是 s，
    // MySQL 里表一旦取了别名原表名即失效（ER_BAD_FIELD_ERROR，实测踩过）。
    // drizzle 0.45 的 mysql2 db.execute 返回的是 mysql2 的原始二元组
    // [rows, fields]（MySql2PreparedQuery.execute 里 raw 分支 `return res`，
    // session.js:47-72；`result[0]` 只在 session.all() 里，:180）——
    // 解构一层拿 rows。
    const [vocabRaw] = (await db.execute(sql`
      SELECT w.english AS word, COALESCE(w.pos, '') AS pos,
             COUNT(*) AS n, COUNT(DISTINCT s.id) AS docs
      FROM sentences s,
        JSON_TABLE(s.words, '$[*]' COLUMNS (
          english VARCHAR(80) PATH '$.english',
          pos VARCHAR(30) PATH '$.pos'
        )) AS w
      WHERE s.lesson_id = ${id} AND s.deleted_at IS NULL
        AND s.words IS NOT NULL
        AND w.english IS NOT NULL AND CHAR_LENGTH(w.english) > 2
      GROUP BY w.english, w.pos
      LIMIT 500
    `)) as unknown as [Array<{ word: string; pos: string; n: number; docs: number }>]

    const vocabRows: VocabRow[] = (vocabRaw ?? []).map((r) => ({
      word: r.word,
      pos: r.pos,
      count: Number(r.n),
      docs: Number(r.docs),
    }))
    const vocab = selectVocab(vocabRows, 20)

    // ── 短语：chunks 优先，dependency nodes 兜底 ────────────────────────────
    const [chunkRaw] = (await db.execute(sql`
      SELECT c.text AS phrase, s.english AS sentence, COUNT(*) AS n
      FROM sentences s,
        JSON_TABLE(s.chunks, '$[*]' COLUMNS (
          text VARCHAR(200) PATH '$.text'
        )) AS c
      WHERE s.lesson_id = ${id} AND s.deleted_at IS NULL
        AND s.chunks IS NOT NULL AND c.text IS NOT NULL
      GROUP BY c.text, s.english
      LIMIT 500
    `)) as unknown as [Array<{ phrase: string; sentence: string | null; n: number }>]

    let phraseRows = (chunkRaw ?? []).map((r) => ({
      phrase: r.phrase,
      count: Number(r.n),
      sentence: r.sentence ?? undefined,
    }))

    if (phraseRows.length === 0) {
      const [nodeRaw] = (await db.execute(sql`
        SELECT n.phrase AS phrase, s.english AS sentence, COUNT(*) AS cnt
        FROM sentences s,
          JSON_TABLE(s.dependency_analysis, '$.nodes[*]' COLUMNS (
            phrase VARCHAR(200) PATH '$.phrase'
          )) AS n
        WHERE s.lesson_id = ${id} AND s.deleted_at IS NULL
          AND s.dependency_analysis IS NOT NULL
          AND n.phrase IS NOT NULL AND CHAR_LENGTH(n.phrase) > 2
        GROUP BY n.phrase, s.english
        LIMIT 500
      `)) as unknown as [Array<{ phrase: string; sentence: string | null; cnt: number }>]
      phraseRows = (nodeRaw ?? []).map((r) => ({
        phrase: r.phrase,
        count: Number(r.cnt),
        sentence: r.sentence ?? undefined,
      }))
    }

    const phrases = selectPhrases(phraseRows, 8)

    return NextResponse.json({
      vocab,
      phrases,
      // 占位（m20696 决议）：语法点与句子复杂度是课节级 AI 分析，库里没有
      // 数据源；返回 null 让前端渲染「暂未生成」而不是编一个。
      grammar: null,
      complexity: null,
    })
  } catch (e) {
    console.error("[lessons/[id]/insight GET]", e)
    return NextResponse.json({ error: "server_error" }, { status: 500 })
  }
}
