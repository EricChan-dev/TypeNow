#!/usr/bin/env tsx
/**
 * 课时扩句：给句子数过少的课时 LLM 生成补充练习句。
 *
 * Run: npx tsx scripts/expand-lessons.ts [--scope=课本同步] [--target=30] [--maxnew=30] [--limit=N] [--apply]
 *   默认 dry：只统计要补多少、预览前几个课时的生成样例，不写库。
 *   --apply 才落库。--limit 只处理前 N 个待补课时（试跑用）。
 *
 * 背景（用户 m23194）：课本同步/课程同步源包每节只有 3-40 句（348 节 <10 句），
 * 用户要求「节数不变、句子数增加」→ 按每节现有句子+主题用 LLM 生成补充句。
 *
 * 生成句的标记与配套：
 *   - tags = ["ai-expanded"]（区别于课本原句）
 *   - words（词性/音标/中文）随生成一次产出，pos 限 UD 白名单（与 pos-labels 一致）
 *   - sentence_structure / chunks 留空，由 analyze-structure.ts / analyze-chunks.ts 后续补
 */

import { config } from "dotenv"
import { join, dirname } from "path"
import { fileURLToPath } from "url"
import { drizzle } from "drizzle-orm/mysql2"
import mysql from "mysql2/promise"
import { eq, and, isNull, asc, like, or, sql } from "drizzle-orm"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
config({ path: join(__dirname, "..", ".env.local") })

import { sentences, lessons, courses } from "../src/lib/db/schema"

const pool = mysql.createPool(process.env.DATABASE_URL!)
const db = drizzle(pool, { mode: "default" })

const args = process.argv.slice(2)
const APPLY = args.includes("--apply")
const scopeArg = args.find((a) => a.startsWith("--scope="))
const scope = scopeArg ? scopeArg.split("=")[1] : null
const TARGET = Number(args.find((a) => a.startsWith("--target="))?.split("=")[1] ?? 30)
const MAXNEW = Number(args.find((a) => a.startsWith("--maxnew="))?.split("=")[1] ?? 30)
const LIMIT = Number(args.find((a) => a.startsWith("--limit="))?.split("=")[1] ?? 0)
const CONC = Number(args.find((a) => a.startsWith("--conc="))?.split("=")[1] ?? 6)
const MODEL = process.env.DEEPSEEK_MODEL || "deepseek-chat"

const UD_POS = new Set(["ADJ", "ADP", "ADV", "AUX", "CCONJ", "DET", "INTJ", "NOUN", "NUM", "PART", "PRON", "PROPN", "PUNCT", "SCONJ", "VERB", "X"])

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ").trim()

const SYSTEM = `你是小学/初中英语教材的练习内容编辑。给定一节课的主题和现有例句，生成与其主题一致、难度相当、词汇相近的补充练习句。要求：
1. 句子为 4-12 个词的英文陈述句/疑问句，难度与现有例句一致，优先复用本课词汇，可少量引入已学常用词。
2. 中文翻译为自然简体中文。
3. 每句给出逐词标注：english（原形或原样）、chinese（词义）、phonetic（{uk,us} IPA 音标，不带斜杠；缩写/数字可给 null）、pos（UD 词性标签：ADJ ADP ADV AUX CCONJ DET INTJ NOUN NUM PART PRON PROPN PUNCT SCONJ VERB 之一；标点可省略整项）。
只输出 JSON 数组，不要任何解释或代码围栏。`

interface GenWord { english: string; chinese: string | null; phonetic: { uk: string; us: string } | null; pos: string }
interface GenSentence { english: string; chinese: string; difficulty: number; words: GenWord[] }

async function llm(messages: Array<{ role: string; content: string }>, retries = 3): Promise<string> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const r = await fetch("https://api.deepseek.com/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}` },
        body: JSON.stringify({ model: MODEL, messages, temperature: 1.1, max_tokens: 8000 }),
      })
      if (r.status === 402) throw new Error("LLM 账户余额不足（402）——请充值后重跑")
      if (r.status === 429 || r.status >= 500) {
        if (attempt === retries) throw new Error(`LLM HTTP ${r.status}（重试 ${retries} 次后仍失败）`)
        await new Promise((res) => setTimeout(res, 2000 * 2 ** attempt))
        continue
      }
      if (!r.ok) throw new Error(`LLM HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`)
      const j = (await r.json()) as { choices: Array<{ message: { content: string } }> }
      return j.choices[0]?.message?.content ?? ""
    } catch (err) {
      if (err instanceof Error && (err.message.includes("402") || attempt === retries)) throw err
      await new Promise((res) => setTimeout(res, 2000 * 2 ** attempt))
    }
  }
  throw new Error("unreachable")
}

function parseSentences(raw: string, lessonTitle: string, need: number): GenSentence[] {
  let text = raw.trim()
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) text = fence[1].trim()
  const start = text.indexOf("[")
  const end = text.lastIndexOf("]")
  if (start === -1 || end === -1 || end <= start) return []
  let arr: unknown
  try {
    arr = JSON.parse(text.slice(start, end + 1))
  } catch {
    return []
  }
  if (!Array.isArray(arr)) return []
  const out: GenSentence[] = []
  for (const item of arr.slice(0, need)) {
    const rec = (item ?? {}) as Record<string, unknown>
    const english = String(rec.english ?? rec.en ?? "").trim().replace(/\s+/g, " ")
    const chinese = String(rec.chinese ?? rec.zh ?? "").trim()
    if (!english || english.length < 4 || english.length > 200) continue
    if (!chinese || !/[\u4e00-\u9fff]/.test(chinese)) continue
    if (!/^[A-Za-z0-9][A-Za-z0-9\s.,!?;:'’"()\-–—?]*$/.test(english)) continue
    const rawWords = Array.isArray(rec.words) ? rec.words : Array.isArray(rec.tokens) ? rec.tokens : []
    const words: GenWord[] = []
    let realWords = 0
    for (const w of rawWords) {
      const wr = (w ?? {}) as Record<string, unknown>
      const we = String(wr.english ?? "").trim()
      const pos = String(wr.pos ?? "").toUpperCase()
      if (!we || !UD_POS.has(pos)) continue
      if (pos !== "PUNCT") realWords++
      const ph = (wr.phonetic ?? null) as { uk?: unknown; us?: unknown } | null
      const phonetic =
        ph && typeof ph.uk === "string" && typeof ph.us === "string" && (ph.uk || ph.us)
          ? { uk: String(ph.uk), us: String(ph.us) }
          : null
      words.push({ english: we, chinese: wr.chinese ? String(wr.chinese) : null, phonetic, pos })
    }
    if (realWords < 2) continue
    const diff = Number(rec.difficulty)
    out.push({ english, chinese, difficulty: diff >= 1 && diff <= 3 ? diff : 1, words })
  }
  if (out.length < Math.min(3, need)) {
    console.warn(`    ⚠ ${lessonTitle}: 只解析出 ${out.length}/${need} 句`)
  }
  return out
}

async function main(): Promise<void> {
  const courseRows = await db
    .select({ id: courses.id, title: courses.title })
    .from(courses)
    .where(
      and(
        isNull(courses.deletedAt),
        scope
          ? like(courses.title, `%${scope}%`)
          : or(like(courses.title, "%课本同步%"), like(courses.title, "%课程同步%")),
      ),
    )

  // 每课时句子数：一次聚合
  const countRows = await db
    .select({ lessonId: sentences.lessonId, n: sql<number>`COUNT(*)` })
    .from(sentences)
    .innerJoin(lessons, eq(sentences.lessonId, lessons.id))
    .innerJoin(courses, eq(lessons.courseId, courses.id))
    .where(
      and(
        isNull(sentences.deletedAt),
        isNull(lessons.deletedAt),
        scope
          ? like(courses.title, `%${scope}%`)
          : or(like(courses.title, "%课本同步%"), like(courses.title, "%课程同步%")),
      ),
    )
    .groupBy(sentences.lessonId)
  const countMap = new Map(countRows.map((r) => [r.lessonId, Number(r.n)]))

  const todo: Array<{ lessonId: string; lessonTitle: string; courseTitle: string; have: number; need: number; maxOrder: number }> = []
  for (const course of courseRows) {
    const ls = await db
      .select({ id: lessons.id, title: lessons.title, sortOrder: lessons.sortOrder })
      .from(lessons)
      .where(and(eq(lessons.courseId, course.id), isNull(lessons.deletedAt)))
      .orderBy(asc(lessons.sortOrder))
    for (const l of ls) {
      const have = countMap.get(l.id) ?? 0
      const need = Math.min(TARGET - have, MAXNEW)
      if (need <= 0) continue
      const [maxRow] = await db
        .select({ m: sql<number>`COALESCE(MAX(${sentences.sortOrder}), -1)` })
        .from(sentences)
        .where(and(eq(sentences.lessonId, l.id), isNull(sentences.deletedAt)))
      todo.push({ lessonId: l.id, lessonTitle: l.title, courseTitle: course.title, have, need, maxOrder: Number(maxRow?.m ?? -1) })
    }
  }

  const lessons2 = LIMIT > 0 ? todo.slice(0, LIMIT) : todo
  const willAdd = lessons2.reduce((a, t) => a + t.need, 0)
  console.log(`\n📚 课时扩句 ${APPLY ? "(APPLY)" : "(DRY 预览)"}`)
  console.log(`   待补课时 ${todo.length} 个（${LIMIT > 0 ? `本次处理 ${lessons2.length}` : "全部"}），将生成约 ${willAdd} 句，目标每节 ≥${TARGET}\n`)

  // 全局去重集：范围内现有英文句
  const seen = new Set<string>()
  const existRows = await db
    .select({ english: sentences.english })
    .from(sentences)
    .innerJoin(lessons, eq(sentences.lessonId, lessons.id))
    .innerJoin(courses, eq(lessons.courseId, courses.id))
    .where(and(isNull(sentences.deletedAt), isNull(lessons.deletedAt), isNull(courses.deletedAt)))
  for (const r of existRows) seen.add(norm(r.english))
  console.log(`   去重基准：库内 ${seen.size} 句\n`)

  let done = 0
  let inserted = 0
  let failed = 0
  const started = Date.now()

  async function processOne(task: (typeof lessons2)[number], index: number): Promise<void> {
    const sample = await db
      .select({ english: sentences.english, chinese: sentences.chinese })
      .from(sentences)
      .where(and(eq(sentences.lessonId, task.lessonId), isNull(sentences.deletedAt)))
      .orderBy(asc(sentences.sortOrder))
      .limit(8)
    const user = [
      `课时标题：${task.lessonTitle}`,
      `所属课程：${task.courseTitle}`,
      `现有例句（english — chinese）：`,
      ...sample.map((s) => `- ${s.english} — ${s.chinese}`),
      ``,
      `请生成 ${Math.min(task.need + 8, 40)} 句新的补充练习句（宁多勿少，无效句会被自动过滤）。`,
    ].join("\n")

    let gens: GenSentence[] = []
    try {
      const raw = await llm([
        { role: "system", content: SYSTEM },
        { role: "user", content: user },
      ])
      gens = parseSentences(raw, task.lessonTitle, task.need)
    } catch (err) {
      failed++
      console.error(`  ✗ [${index + 1}/${lessons2.length}] ${task.courseTitle} / ${task.lessonTitle}: ${(err as Error).message}`)
      if ((err as Error).message.includes("402")) throw err
      return
    }

    const accepted: GenSentence[] = []
    const seenLocal = new Set<string>()
    for (const g of gens) {
      const key = norm(g.english)
      if (!key || seen.has(key) || seenLocal.has(key)) continue
      seenLocal.add(key)
      accepted.push(g)
      if (accepted.length >= task.need) break
    }
    for (const g of accepted) seen.add(norm(g.english))

    if (APPLY && accepted.length > 0) {
      let order = task.maxOrder + 1
      for (const g of accepted) {
        await db.insert(sentences).values({
          chinese: g.chinese,
          english: g.english,
          wordsCount: g.words.length,
          lessonId: task.lessonId,
          words: g.words,
          tags: ["ai-expanded"],
          difficulty: g.difficulty,
          sortOrder: order++,
        })
      }
      inserted += accepted.length
    }
    done++
    if (done % 20 === 0 || done === lessons2.length) {
      const etaMin = Math.round(((Date.now() - started) / done) * (lessons2.length - done) / 60000)
      console.log(`  [${done}/${lessons2.length}] 已生成 ${inserted} 句${APPLY ? "" : "（dry）"} ~${etaMin}min left`)
    }
    if (index < 2) {
      console.log(`  ◇ ${task.courseTitle} / ${task.lessonTitle}（现有 ${task.have} → 补 ${accepted.length}）`)
      for (const g of accepted.slice(0, 3)) {
        console.log(`      ${g.english}`)
        console.log(`        ${g.chinese} | ${g.words.slice(0, 4).map((w) => `${w.english}/${w.pos}${w.phonetic ? "/" + w.phonetic.us : ""}`).join(" ")}`)
      }
    }
  }

  const queue = [...lessons2.entries()]
  const workers = Array.from({ length: CONC }, async () => {
    while (queue.length > 0) {
      const next = queue.shift()
      if (!next) break
      await processOne(next[1], next[0])
    }
  })
  try {
    await Promise.all(workers)
  } catch (err) {
    console.error(`\n❌ 中断: ${(err as Error).message}`)
    console.error(`   已完成 ${done}/${lessons2.length}，生成 ${inserted} 句。修复问题后重跑即可续（空缺句不重复生成）。`)
    await pool.end()
    process.exit(1)
  }

  console.log(`\n${APPLY ? "✅" : "📋"} 扩句${APPLY ? "完成" : "预览完成"}：课时 ${done}，生成 ${inserted} 句，失败课时 ${failed}`)
  if (!APPLY) console.log("   确认无误后加 --apply 执行落库")
  await pool.end()
}

main().catch(async (err) => {
  console.error("Fatal error:", err)
  await pool.end()
  process.exit(1)
})
