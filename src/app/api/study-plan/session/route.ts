// 学习练习 session 拉取：两种模式共用一条 GET。
//   mode=unit&lessonId=…  → 该单元里「还没学过」的新词 ≤15（首次作答时才入库）
//   mode=review           → 到期词 ≤20，按 next_review_at 升序（最久没排期的先来）
// 释义/音标三层兜底：word_dictionary_cache → sentences.words JSON → 空（前端显示 —）。
import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth/session"
import { db } from "@/lib/db"
import {
  lessons,
  sentences,
  studyPlanWords,
  studyPlans,
  wordDictionaryCache,
} from "@/lib/db/schema"
import { and, asc, eq, inArray, isNotNull, isNull, lte, sql } from "drizzle-orm"
import { normalizeWordToken, phoneticPair, type LegacyPhonetic } from "@/lib/study-plan"
import { wrapPhonetic } from "@/lib/dict-display"

const UNIT_BATCH = 15
const REVIEW_BATCH = 20

interface SentenceWordsRow {
  lessonId: string | null
  words: Array<{ english: string; chinese?: string | null; phonetic?: LegacyPhonetic }> | null
}

interface WordMeta {
  us: string
  uk: string
  translation: string | null
}

/** sentences.words JSON 现算：有序去重 token + 每词第一条元数据（音标/中文）。 */
function collectUnitWords(
  rows: SentenceWordsRow[],
  lessonId: string
): { tokens: string[]; meta: Map<string, WordMeta> } {
  const tokens: string[] = []
  const seen = new Set<string>()
  const meta = new Map<string, WordMeta>()
  for (const row of rows) {
    if (row.lessonId !== lessonId) continue
    for (const w of row.words ?? []) {
      const token = normalizeWordToken(w.english ?? "")
      if (!token) continue
      if (!seen.has(token)) {
        seen.add(token)
        tokens.push(token)
      }
      if (!meta.has(token)) {
        const pair = phoneticPair(w.phonetic ?? null)
        const chinese = (w.chinese ?? "").trim() || null
        meta.set(token, { us: pair.us, uk: pair.uk, translation: chinese })
      } else {
        // 第一条没带中文/音标时，后句补上（词在多句里反复出现很常见）
        const cur = meta.get(token)!
        const pair = phoneticPair(w.phonetic ?? null)
        if (!cur.us && pair.us) cur.us = pair.us
        if (!cur.uk && pair.uk) cur.uk = pair.uk
        if (!cur.translation) cur.translation = (w.chinese ?? "").trim() || null
      }
    }
  }
  return { tokens, meta }
}

/** 全课程扫一遍找词元数据（review 兜底：cache 没有的词回课程句子里找）。 */
async function metaFromCourseSentences(
  courseId: string,
  tokens: string[]
): Promise<Map<string, WordMeta>> {
  const out = new Map<string, WordMeta>()
  if (tokens.length === 0) return out
  const pending = new Set(tokens)
  const rows = (await db!
    .select({ words: sentences.words })
    .from(sentences)
    .innerJoin(lessons, eq(lessons.id, sentences.lessonId))
    .where(and(eq(lessons.courseId, courseId), isNotNull(sentences.words)))
    .orderBy(asc(sentences.sortOrder))) as unknown as SentenceWordsRow[]
  for (const row of rows) {
    for (const w of row.words ?? []) {
      const token = normalizeWordToken(w.english ?? "")
      if (!token || !pending.has(token)) continue
      const pair = phoneticPair(w.phonetic ?? null)
      out.set(token, { us: pair.us, uk: pair.uk, translation: (w.chinese ?? "").trim() || null })
      pending.delete(token)
      if (pending.size === 0) return out
    }
  }
  return out
}

export async function GET(request: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })

  const [plan] = await db
    .select({ id: studyPlans.id, courseId: studyPlans.courseId })
    .from(studyPlans)
    .where(eq(studyPlans.userId, session.userId))
    .limit(1)
  if (!plan) return NextResponse.json({ error: "no_plan" }, { status: 404 })

  const mode = request.nextUrl.searchParams.get("mode") === "review" ? "review" : "unit"

  if (mode === "unit") {
    const lessonId = (request.nextUrl.searchParams.get("lessonId") ?? "").trim()
    if (!lessonId || lessonId.length > 36) {
      return NextResponse.json({ error: "invalid_lesson" }, { status: 400 })
    }
    const [lesson] = await db
      .select({ id: lessons.id, title: lessons.title })
      .from(lessons)
      .where(
        and(
          eq(lessons.id, lessonId),
          eq(lessons.courseId, plan.courseId),
          isNull(lessons.deletedAt)
        )
      )
      .limit(1)
    if (!lesson) return NextResponse.json({ error: "lesson_not_found" }, { status: 404 })

    const sentenceRows = (await db
      .select({ lessonId: sentences.lessonId, words: sentences.words })
      .from(sentences)
      .innerJoin(lessons, eq(lessons.id, sentences.lessonId))
      .where(and(eq(lessons.courseId, plan.courseId), isNotNull(sentences.words)))
      .orderBy(asc(sentences.sortOrder))) as unknown as SentenceWordsRow[]
    const { tokens, meta } = collectUnitWords(sentenceRows, lessonId)

    const learned = await db
      .select({ word: studyPlanWords.word })
      .from(studyPlanWords)
      .where(eq(studyPlanWords.planId, plan.id))
    const learnedSet = new Set(learned.map((r) => r.word))
    const newTokens = tokens.filter((t) => !learnedSet.has(t))

    const batch = newTokens.slice(0, UNIT_BATCH)
    const items = await enrich(plan.courseId, batch, meta)
    return NextResponse.json({
      mode,
      unit: { lessonId: lesson.id, title: lesson.title },
      items,
      totalNew: newTokens.length,
    })
  }

  // ── review 模式 ──────────────────────────────────────────────────────────
  const dueRows = await db
    .select({
      word: studyPlanWords.word,
      lessonId: studyPlanWords.lessonId,
      intervalDays: studyPlanWords.intervalDays,
      status: studyPlanWords.status,
    })
    .from(studyPlanWords)
    .where(
      and(
        eq(studyPlanWords.planId, plan.id),
        lte(studyPlanWords.nextReviewAt, new Date())
      )
    )
    .orderBy(asc(studyPlanWords.nextReviewAt))
    .limit(REVIEW_BATCH)

  const [dueCountRow] = await db
    .select({ due: sql<number>`COUNT(*)` })
    .from(studyPlanWords)
    .where(
      and(eq(studyPlanWords.planId, plan.id), lte(studyPlanWords.nextReviewAt, new Date()))
    )

  const items = await enrich(plan.courseId, dueRows.map((r) => r.word), new Map())
  // 把词的归属单元带给客户端 —— answer 路由按它落库（NOT NULL），复习不改归属。
  const lessonByWord = new Map(dueRows.map((r) => [r.word, r.lessonId]))
  return NextResponse.json({
    mode,
    items: items.map((it) => ({ ...it, lessonId: lessonByWord.get(it.word) ?? "" })),
    dueTotal: Number(dueCountRow?.due ?? 0),
  })
}

/** 三层兜底取释义：缓存 →（unit 模式现算的）句内 JSON → 课程句子扫描。 */
async function enrich(
  courseId: string,
  tokens: string[],
  preMeta: Map<string, WordMeta>
): Promise<Array<{ word: string; phonetic: { us: string; uk: string }; translation: string | null }>> {
  const merged = new Map<string, WordMeta>()
  for (const t of tokens) {
    const base = preMeta.get(t)
    merged.set(t, base ?? { us: "", uk: "", translation: null })
  }
  const missing = tokens.filter((t) => !merged.get(t)!.translation)

  if (missing.length > 0) {
    const cacheRows = await db!
      .select({
        word: wordDictionaryCache.word,
        phonetic: wordDictionaryCache.phonetic,
        phoneticUk: wordDictionaryCache.phoneticUk,
        translations: wordDictionaryCache.translations,
      })
      .from(wordDictionaryCache)
      .where(inArray(wordDictionaryCache.word, missing))
    for (const row of cacheRows) {
      const cur = merged.get(row.word)!
      if (row.phonetic && !cur.us) cur.us = wrapPhonetic(row.phonetic)
      if (row.phoneticUk && !cur.uk) cur.uk = wrapPhonetic(row.phoneticUk)
      if (!cur.translation) cur.translation = row.translations[0] ?? null
    }
    const stillMissing = tokens.filter((t) => !merged.get(t)!.translation)
    if (stillMissing.length > 0) {
      const fromSentences = await metaFromCourseSentences(courseId, stillMissing)
      for (const [token, m] of fromSentences) {
        const cur = merged.get(token)!
        if (!cur.us && m.us) cur.us = m.us
        if (!cur.uk && m.uk) cur.uk = m.uk
        if (!cur.translation && m.translation) cur.translation = m.translation
      }
    }
  }

  return tokens.map((word) => {
    const m = merged.get(word)!
    return { word, phonetic: { us: m.us, uk: m.uk }, translation: m.translation }
  })
}
