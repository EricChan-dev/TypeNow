#!/usr/bin/env tsx
/**
 * 句子分段数据（chunks）回填：给缺 chunks 的句子生成「层级累积」分段候选集。
 *
 * Run: npx tsx scripts/analyze-chunks.ts [课程标题LIKE] [--limit=N] [--conc=10] [--apply]
 *   默认 dry（只统计），--apply 才写库。
 *
 * 背景（用户 m23194）：范围内 31,632 句 chunks 100% 缺失 → 分段练习退化为整句听写。
 * chunks 契约（src/lib/fragment-practice.ts:233 fragmentsForSentence）：
 *   候选片段集 {text, order, chinese}，含短片段+相邻合并+整句，DP 线性化
 *   求不重叠铺满最多段；铺不满 → null → 退整句听写。
 * 生成策略：LLM 只产出 base 线性切分（2-6 段连续短语，拼接==原句）+ 相邻合并，
 *   脚本校验 base 铺满后拼装 base + combos + 整句写库（与库内样例同构，
 *   见「Our relationships…」样例：短片段 order 1,2,4,5 / 合并 3,6 / 整句 7）。
 */

import { config } from "dotenv"
import { join, dirname } from "path"
import { fileURLToPath } from "url"
import { drizzle } from "drizzle-orm/mysql2"
import mysql from "mysql2/promise"
import { eq, and, isNull, sql, like, or } from "drizzle-orm"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
config({ path: join(__dirname, "..", ".env.local") })

import { sentences, lessons, courses } from "../src/lib/db/schema"
import { normalizeSentenceForComparison } from "../src/lib/structured-answer"
import { chat, isProviderDown, activeProvider } from "./llm-provider"

const pool = mysql.createPool(process.env.DATABASE_URL!)
const db = drizzle(pool, { mode: "default" })

const args = process.argv.slice(2)
const APPLY = args.includes("--apply")
const scopeArg = args.find((a) => !a.startsWith("--"))
const scope = scopeArg ?? null
const LIMIT = Number(args.find((a) => a.startsWith("--limit="))?.split("=")[1] ?? 0)
const CONC = Number(args.find((a) => a.startsWith("--conc="))?.split("=")[1] ?? 10)

const SYSTEM = `你是英语教学句法分析员。把给定的英文句子切分成 2-6 个连续的短语片段：按原句顺序、无重叠、拼接后恰好等于原句（含标点）。
输出 JSON 对象（不要代码围栏、不要解释）：
{"base":[{"text":"原句里的连续片段","chinese":"该片段的中文"}],"combos":[{"text":"相邻片段合并后的较大片段","chinese":"中文"}]}
要求：
- base：2-6 个片段，按顺序，text 必须逐字符来自原句（可用空格在词边界切分），拼接后与原句完全一致。
- combos：base 中相邻 1-3 个片段的合并结果，1-3 个即可；text 同样逐字符来自原句。
- chinese 为自然简体中文翻译，不是逐词直译。`

interface ChunkPart { text: string; chinese: string }

async function llm(messages: Array<{ role: string; content: string }>): Promise<string> {
  return chat(messages, { temperature: 0.3, maxTokens: 1500 })
}

function normJoin(parts: string[]): string {
  return normalizeSentenceForComparison(parts.join(" "))
}

function parseChunks(raw: string, english: string): ChunkPart[] | null {
  let text = raw.trim()
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) text = fence[1].trim()
  const start = text.indexOf("{")
  const end = text.lastIndexOf("}")
  if (start === -1 || end === -1 || end <= start) return null
  let obj: unknown
  try {
    obj = JSON.parse(text.slice(start, end + 1))
  } catch {
    return null
  }
  const rec = (obj ?? {}) as Record<string, unknown>
  const baseRaw = Array.isArray(rec.base) ? rec.base : Array.isArray(obj) ? obj : null
  if (!baseRaw || baseRaw.length < 2) return null

  const parts: ChunkPart[] = []
  for (const item of baseRaw) {
    const r = (item ?? {}) as Record<string, unknown>
    const t = String(r.text ?? "").trim()
    const zh = String(r.chinese ?? "").trim()
    if (!t || !zh) return null
    parts.push({ text: t, chinese: zh })
  }
  // base 切分必须恰好铺满原句（归一化比对，大小写/标点差异容忍）
  if (normJoin(parts.map((p) => p.text)) !== normalizeSentenceForComparison(english)) return null
  return parts
}

async function main(): Promise<void> {
  const where = and(
    isNull(sentences.deletedAt),
    isNull(lessons.deletedAt),
    isNull(courses.deletedAt),
    or(sql`${sentences.chunks} IS NULL`, sql`JSON_LENGTH(${sentences.chunks}) = 0`),
    scope ? like(courses.title, `%${scope}%`) : undefined,
  )

  const [{ total }] = await db
    .select({ total: sql<number>`COUNT(*)` })
    .from(sentences)
    .innerJoin(lessons, eq(sentences.lessonId, lessons.id))
    .innerJoin(courses, eq(lessons.courseId, courses.id))
    .where(where)
  const targets = await db
    .select({
      id: sentences.id,
      english: sentences.english,
      chinese: sentences.chinese,
    })
    .from(sentences)
    .innerJoin(lessons, eq(sentences.lessonId, lessons.id))
    .innerJoin(courses, eq(lessons.courseId, courses.id))
    .where(where)
    .orderBy(sentences.lessonId, sentences.sortOrder)
    .limit(LIMIT > 0 ? LIMIT : 1000000)

  const list = LIMIT > 0 ? targets.slice(0, LIMIT) : targets
  console.log(`\n🧩 chunks 回填 ${APPLY ? "(APPLY)" : "(DRY 预览)"}`)
  console.log(`   缺 chunks 句子共 ${Number(total)}；本次处理 ${list.length}，并发 ${CONC}，LLM ${activeProvider()}\n`)

  let done = 0
  let ok = 0
  let failed = 0
  const started = Date.now()

  async function processOne(s: { id: string; english: string; chinese: string | null }, index: number): Promise<void> {
    try {
      const raw = await llm([
        { role: "system", content: SYSTEM },
        { role: "user", content: `句子：${s.english}\n中文参考：${s.chinese ?? "(无)"}` },
      ])
      const base = parseChunks(raw, s.english)
      if (!base) {
        failed++
        return
      }
      // 组合片段：相邻 base 合并（1-3 段）由 LLM 给出？——合并由脚本确定性生成，保证连续性
      const combos: ChunkPart[] = []
      for (let i = 0; i < base.length - 1; i++) {
        const text = base.slice(i, i + 2).map((p) => p.text).join(" ")
        const chinese = base.slice(i, i + 2).map((p) => p.chinese).join("")
        combos.push({ text, chinese })
      }
      const all = [...base, ...combos, { text: s.english, chinese: s.chinese ?? "" }]
      const chunks = all.map((c, i) => ({ text: c.text, order: i + 1, chinese: c.chinese }))
      if (APPLY) {
        await db.update(sentences).set({ chunks }).where(eq(sentences.id, s.id))
      }
      ok++
      if (index < 2) {
        console.log(`  ◇ ${s.english}`)
        for (const c of chunks) console.log(`      ${c.order}. ${c.text} — ${c.chinese}`)
      }
    } catch (err) {
      failed++
      console.error(`  ✗ [${index + 1}] ${s.english.slice(0, 40)}: ${(err as Error).message}`)
      if (isProviderDown(err)) throw err
      return
    } finally {
      done++
      if (done % 100 === 0 || done === list.length) {
        const rate = done / ((Date.now() - started) / 60000)
        const etaMin = Math.round((list.length - done) / Math.max(rate, 1))
        console.log(`  [${done}/${list.length}] ok ${ok} / failed ${failed} ${rate.toFixed(0)}句/min ~${etaMin}min left`)
      }
    }
  }

  const queue = [...list.entries()]
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
    console.error(`   已处理 ${done}/${list.length}（ok ${ok}）。待补条件天然续跑，修复后重跑即可。`)
    await pool.end()
    process.exit(1)
  }

  console.log(`\n${APPLY ? "✅" : "📋"} chunks 回填${APPLY ? "完成" : "预览完成"}：处理 ${done}，成功 ${ok}，失败 ${failed}`)
  if (!APPLY) console.log("   确认后加 --apply 执行")
  await pool.end()
}

main().catch(async (err) => {
  console.error("Fatal error:", err)
  await pool.end()
  process.exit(1)
})
