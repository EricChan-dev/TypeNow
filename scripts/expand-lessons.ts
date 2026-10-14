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
import { chat, isProviderDown, activeProvider } from "./llm-provider"

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
/** 单轮 LLM 生成上限：一次要太多句模型会长 JSON 出错，分轮补齐更稳。 */
const BATCH = Number(args.find((a) => a.startsWith("--batch="))?.split("=")[1] ?? 8)

const UD_POS = new Set(["ADJ", "ADP", "ADV", "AUX", "CCONJ", "DET", "INTJ", "NOUN", "NUM", "PART", "PRON", "PROPN", "PUNCT", "SCONJ", "VERB", "X"])

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ").trim()

const SYSTEM = `你是小学/初中英语教材的练习内容编辑。给定一节课的主题和现有例句，生成与其主题一致、难度相当、词汇相近的补充练习句。

要求：
1. 句子为 4-12 个词的英文陈述句/疑问句，难度与现有例句一致，优先复用本课词汇。
2. 中文翻译为自然简体中文。
3. **每句必须带 words 数组**：逐词给出 english（原样）、chinese（词义）、phonetic（{"uk":音标,"us":音标}，IPA 不带斜杠；无法确定时给 null）、pos（UD 词性标签，只能取 ADJ ADP ADV AUX CCONJ DET INTJ NOUN NUM PART PRON PROPN PUNCT SCONJ VERB 之一）。标点也作为一项，pos 用 PUNCT、chinese/phonetic 用 null。

必须严格按下面的结构输出（顶层是数组，不是对象；words 必须是数组）：
[
  {
    "english": "I read books.",
    "chinese": "我读书。",
    "difficulty": 1,
    "words": [
      {"english": "I", "chinese": "我", "phonetic": {"uk": "aɪ", "us": "aɪ"}, "pos": "PRON"},
      {"english": "read", "chinese": "读", "phonetic": {"uk": "riːd", "us": "riːd"}, "pos": "VERB"},
      {"english": "books", "chinese": "书", "phonetic": {"uk": "bʊks", "us": "bʊks"}, "pos": "NOUN"},
      {"english": ".", "chinese": null, "phonetic": null, "pos": "PUNCT"}
    ]
  }
]

只输出这个 JSON 数组，不要任何解释、不要代码围栏、不要在句子上直接放 pos 数组。`

interface GenWord { english: string; chinese: string | null; phonetic: { uk: string; us: string } | null; pos: string }
interface GenSentence { english: string; chinese: string; difficulty: number; words: GenWord[] }

async function llm(messages: Array<{ role: string; content: string }>): Promise<string> {
  return chat(messages, { temperature: 1.1, maxTokens: 8000 })
}

/** 远程库长跑偶发连接瞬断（试跑 17/20 时撞过一次）：insert 失败退避重试，不中断整批。 */
async function insertWithRetry(values: typeof sentences.$inferInsert, retries = 3): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await db.insert(sentences).values(values)
      return
    } catch (err) {
      if (attempt >= retries) throw err
      await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt))
    }
  }
}

/**
 * 从可能破损的数组文本里逐个抢救对象。
 *
 * 背景：一次要 30+ 句时 GLM 会吐 ~6.5K token / 18KB JSON，中途偶发语法错误
 * （实测 position 12338 "Expected ':' after property name"）——整体 JSON.parse
 * 直接归零，白跑一次调用。这里按花括号配平逐对象提取，坏的丢掉、好的留下。
 */
function salvageObjects(text: string): unknown[] {
  const out: unknown[] = []
  let depth = 0
  let start = -1
  let inStr = false
  let escaped = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inStr) {
      if (escaped) escaped = false
      else if (ch === "\\") escaped = true
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') {
      inStr = true
      continue
    }
    if (ch === "{") {
      if (depth === 0) start = i
      depth++
      continue
    }
    if (ch === "}") {
      if (depth > 0) {
        depth--
        if (depth === 0 && start !== -1) {
          try {
            out.push(JSON.parse(text.slice(start, i + 1)))
          } catch {
            /* 单个对象坏了就丢，继续下一个 */
          }
          start = -1
        }
      }
    }
  }
  return out
}

function parseSentences(raw: string, lessonTitle: string, need: number): GenSentence[] {
  let text = raw.trim()
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) text = fence[1].trim()
  const start = text.indexOf("[")
  const end = text.lastIndexOf("]")
  let arr: unknown = null
  if (start !== -1 && end > start) {
    try {
      arr = JSON.parse(text.slice(start, end + 1))
    } catch {
      arr = salvageObjects(text.slice(start, end + 1))
    }
  } else {
    arr = salvageObjects(text)
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
  console.log(`   待补课时 ${todo.length} 个（${LIMIT > 0 ? `本次处理 ${lessons2.length}` : "全部"}），将生成约 ${willAdd} 句，目标每节 ≥${TARGET}，LLM ${activeProvider()}\n`)

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

    // 分轮生成：一次要 30+ 句 GLM 会吐 ~6.5K token 的长 JSON，偶发中途语法错误。
    // 每轮只要 BATCH 句（默认 12），轮内失败不影响其它轮，也便于去重后继续补齐。
    const accepted: GenSentence[] = []
    const seenLocal = new Set<string>()
    const sampleLines = sample.map((s) => `- ${s.english} — ${s.chinese}`)
    const maxRounds = 6
    for (let round = 0; round < maxRounds && accepted.length < task.need; round++) {
      const want = Math.min(task.need - accepted.length + 4, BATCH)
      const avoid = [...sampleLines, ...accepted.map((g) => `- ${g.english} — ${g.chinese}`)]
      const user = [
        `课时标题：${task.lessonTitle}`,
        `所属课程：${task.courseTitle}`,
        `参考例句（english — chinese，不要重复这些句子）：`,
        ...avoid,
        ``,
        `请生成 ${want} 句新的补充练习句（宁多勿少，无效句会被自动过滤）。`,
      ].join("\n")
      let gens: GenSentence[] = []
      try {
        const raw = await llm([
          { role: "system", content: SYSTEM },
          { role: "user", content: user },
        ])
        gens = parseSentences(raw, task.lessonTitle, want)
      } catch (err) {
        failed++
        console.error(`  ✗ [${index + 1}/${lessons2.length}] ${task.courseTitle} / ${task.lessonTitle}: ${(err as Error).message}`)
        if (isProviderDown(err)) throw err
        return
      }
      if (index < 2) console.log(`      · 第 ${round + 1} 轮要 ${want} 句 → 解析 ${gens.length}`)
      for (const g of gens) {
        const key = norm(g.english)
        if (!key || seen.has(key) || seenLocal.has(key)) continue
        seenLocal.add(key)
        accepted.push(g)
        if (accepted.length >= task.need) break
      }
    }
    for (const g of accepted) seen.add(norm(g.english))

    if (APPLY && accepted.length > 0) {
      let order = task.maxOrder + 1
      for (const g of accepted) {
        await insertWithRetry({
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
      console.log(`  ◇ ${task.courseTitle} / ${task.lessonTitle}（现有 ${task.have} → 需 ${task.need}，采纳 ${accepted.length}）`)
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
