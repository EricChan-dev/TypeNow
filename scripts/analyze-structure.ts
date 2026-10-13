#!/usr/bin/env tsx
/**
 * Batch-generate sentence structure（短语/成分）for sentences where sentence_structure IS NULL or empty.
 * Run: npx tsx scripts/analyze-structure.ts [课程标题LIKE子串] [--limit=N] [--dry]
 *
 * Idempotent: skips sentences that already have structure.
 * Concurrency=10, same pace as analyze-words.
 *
 * start/end 必须与 src/lib/dictation-tokens.ts 的 dictationTokens() 对齐 ——
 * structured-answer.ts 的「聚焦第 N 格 → 高亮所属成分」直接用这对下标，
 * 错一个词高亮就错位，所以写入前逐项校验：tokens[start..end] 归一后必须
 * 与组件 text 一致，不一致直接丢弃该成分（宁可缺数据，不可高亮错词）。
 */

import { config } from "dotenv"
import { join, dirname } from "path"
import { fileURLToPath } from "url"
import { drizzle } from "drizzle-orm/mysql2"
import mysql from "mysql2/promise"
import { isNull, eq, or, sql, like, and } from "drizzle-orm"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

config({ path: join(__dirname, "..", ".env.local") })

import { sentences, lessons, courses } from "../src/lib/db/schema"
import { llmCall } from "../src/lib/llm"
import { dictationTokens } from "../src/lib/dictation-tokens"

const pool = mysql.createPool(process.env.DATABASE_URL!)
const db = drizzle(pool, { schema: { sentences }, mode: "default" })

type Component = {
  start: number
  end: number
  role: string
  text: string
  type: string
  explanation: string
}

/** role(中文) ↔ type(英文) 对照。role 直接进 UI 标签，type 只进 CSS 类名。 */
const ROLE_TYPE: Array<{ role: string; type: string }> = [
  { role: "主语", type: "subject" },
  { role: "谓语", type: "predicate" },
  { role: "宾语", type: "object" },
  { role: "表语", type: "predicative" },
  { role: "定语", type: "attribute" },
  { role: "状语", type: "adverbial" },
  { role: "补语", type: "complement" },
  { role: "宾语补足语", type: "object_complement" },
  { role: "同位语", type: "appositive" },
  { role: "插入语", type: "parenthesis" },
  { role: "形式主语", type: "formal_subject" },
]
const ROLE_SET = new Map(ROLE_TYPE.map((r) => [r.role, r.type]))
const TYPE_SET = new Map(ROLE_TYPE.map((r) => [r.type, r.role]))

const SYSTEM_PROMPT = `你是英语语法专家。请把英文句子按成分切分，返回 JSON 数组，每项格式：
{"start":起词下标,"end":止词下标,"role":"中文成分名","type":"英文类型","text":"成分原文","explanation":"中文解释"}

start/end 是给定分词表中的下标（含两端）。
role 只能用：主语 / 谓语 / 宾语 / 表语 / 定语 / 状语 / 补语 / 宾语补足语 / 同位语 / 插入语 / 形式主语
type 是 role 对应的英文小写（subject/predicate/object/predicative/attribute/adverbial/complement/object_complement/appositive/parenthesis/formal_subject）。
text 写成分原文（以原句大小写为准，可带上紧邻标点）。
explanation 用一两句中文解释该成分的结构和作用（如「这是一个名词短语，'Daddy's' 是名词所有格作定语，修饰 'number'，整个短语作宾语」）。

规则：
- 短句通常 2-4 个成分，长句可更多；助动词、虚词可以不归入任何成分（允许缺口）。
- 同一成分跨多个连续词时合并为一个对象，不要逐词拆。
- 谓语必须是限定动词（含助动词+实义动词整体），不定式短语按其句法功能归成分。
- 只输出 JSON 数组，不要任何解释或 markdown。`

function extractJsonArray(raw: string): string {
  const block = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (block) return block[1].trim()
  const start = raw.indexOf("[")
  const end = raw.lastIndexOf("]")
  if (start !== -1 && end > start) return raw.slice(start, end + 1)
  return raw
}

/** 归一比较：小写、只留字母数字与撇号 —— 与 dictationTokens 的口径对齐。 */
function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9']/g, "")
}

/** 校验并修复一个句子的一批成分；返回通过校验的部分。 */
function validateComponents(raw: string, english: string): Component[] {
  const tokens = dictationTokens(english)
  let list: Array<Record<string, unknown>>
  try {
    list = JSON.parse(extractJsonArray(raw)) as Array<Record<string, unknown>>
  } catch {
    throw new Error("JSON 解析失败")
  }
  if (!Array.isArray(list)) throw new Error("返回不是数组")

  const out: Component[] = []
  for (const item of list) {
    const start = Number(item.start)
    const end = Number(item.end)
    if (!Number.isInteger(start) || !Number.isInteger(end)) continue
    if (start < 0 || end < start || end >= tokens.length) continue
    // role/type 必须落在封闭词表里（只认 role；type 仅用于 CSS 类名，由 role 反查保证一致）
    const roleRaw = String(item.role ?? "").trim()
    const typeRaw = String(item.type ?? "").trim().toLowerCase()
    let role = roleRaw
    if (!ROLE_SET.has(role)) {
      const byType = TYPE_SET.get(typeRaw)
      if (!byType) continue
      role = byType
    }
    const type = ROLE_SET.get(role)!
    // 文本校验：text 归一后必须等于 tokens[start..end] 归一后拼接
    const text = String(item.text ?? "").trim()
    const expected = tokens.slice(start, end + 1).join(" ")
    if (norm(text) !== norm(expected)) continue
    const explanation = String(item.explanation ?? "").trim()
    out.push({ start, end, role, text, type, explanation })
  }
  // 按 start 排序 + 去重 + 剔除互相重叠的（保留先出现的）
  out.sort((a, b) => a.start - b.start || a.end - b.end)
  const dedup: Component[] = []
  for (const c of out) {
    if (dedup.some((d) => c.start <= d.end && d.start <= c.end)) continue
    dedup.push(c)
  }
  return dedup
}

async function analyzeStructure(english: string, chinese: string): Promise<Component[]> {
  const tokens = dictationTokens(english)
  const numbered = tokens.map((t, i) => `${i}:${t}`).join(" ")
  const raw = await llmCall({
    systemPrompt: SYSTEM_PROMPT,
    userMessage: `句子：${english}\n中文：${chinese}\n分词表：${numbered}`,
    temperature: 0.2,
  })
  return validateComponents(raw, english)
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<void>
): Promise<void> {
  let index = 0
  async function worker(): Promise<void> {
    while (index < items.length) {
      const i = index++
      await fn(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()))
}

async function main(): Promise<void> {
  const CONCURRENCY = 10
  const args = process.argv.slice(2)
  const dry = args.includes("--dry")
  const limitArg = args.find((a) => a.startsWith("--limit="))
  const limit = limitArg ? Number(limitArg.split("=")[1]) : null
  const scope = args.find((a) => !a.startsWith("--"))?.trim() || null

  // 待补 = sentence_structure IS NULL **或空数组**（与 analyze-words 同口径：
  // 空数组同样是批量导入的遗留）。
  const pendingQuery = db
    .select({ id: sentences.id, english: sentences.english, chinese: sentences.chinese })
    .from(sentences)
  const pendingBase = scope
    ? pendingQuery
        .innerJoin(lessons, eq(sentences.lessonId, lessons.id))
        .innerJoin(courses, eq(lessons.courseId, courses.id))
        .where(
          and(
            or(
              isNull(sentences.sentenceStructure),
              sql`JSON_LENGTH(${sentences.sentenceStructure}) = 0`
            ),
            like(courses.title, `%${scope}%`)
          )
        )
    : pendingQuery.where(
        or(
          isNull(sentences.sentenceStructure),
          sql`JSON_LENGTH(${sentences.sentenceStructure}) = 0`
        )
      )
  let pending = await pendingBase
  if (limit && pending.length > limit) pending = pending.slice(0, limit)

  console.log(`\n📖 Analyze Structure Script${dry ? " (DRY)" : ""}`)
  console.log(`   Scope: ${scope ?? "全库"}`)
  console.log(`   Pending (no structure): ${pending.length}`)
  console.log(`   Concurrency: ${CONCURRENCY}`)
  console.log(`   Estimated time: ~${Math.ceil((pending.length / CONCURRENCY) * 10 / 60)} minutes\n`)

  if (pending.length === 0) {
    console.log("✅ All sentences already have structure!")
    await pool.end()
    return
  }

  let done = 0
  let failed = 0
  let empty = 0
  const startTime = Date.now()

  await runWithConcurrency(pending, CONCURRENCY, async (s, i) => {
    try {
      const components = await analyzeStructure(s.english ?? "", s.chinese ?? "")
      if (components.length === 0) {
        // LLM 正常返回但没有任何成分通过校验 —— 记为失败，不写空数组
        failed++
        if (failed <= 20) console.error(`  EMPTY [${i}] ${s.english?.slice(0, 60)}`)
        return
      }
      if (!dry) {
        await db
          .update(sentences)
          .set({ sentenceStructure: components })
          .where(eq(sentences.id, s.id))
      }
      done++
      if (dry && done <= 5) {
        console.log(`  样例 ${s.english?.slice(0, 60)}`)
        console.log("    " + JSON.stringify(components))
      }
      if (done % 50 === 0 || done <= 10) {
        const elapsed = Math.round((Date.now() - startTime) / 1000)
        const rate = done / elapsed
        const remaining = Math.round((pending.length - done) / rate)
        console.log(`  [${done}/${pending.length}] ✓ ~${Math.ceil(remaining / 60)}min left`)
      }
    } catch (err) {
      failed++
      if (failed <= 20) {
        console.error(`  FAIL [${i}] ${s.english?.slice(0, 50)}: ${err instanceof Error ? err.message : err}`)
      }
    }
  })

  const elapsed = Math.round((Date.now() - startTime) / 1000)
  console.log(`\n✅ Analyze complete!`)
  console.log(`   Done:    ${done}`)
  console.log(`   Failed:  ${failed}`)
  console.log(`   Elapsed: ${Math.floor(elapsed / 60)}m ${elapsed % 60}s`)

  await pool.end()
}

main().catch((err) => {
  console.error("Fatal error:", err)
  process.exit(1)
})
