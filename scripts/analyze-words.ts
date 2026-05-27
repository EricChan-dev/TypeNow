#!/usr/bin/env tsx
/**
 * Batch-generate per-word phonetics + POS for all sentences where words IS NULL.
 * Run: pnpm analyze-words
 *
 * Idempotent: skips sentences that already have words.
 * Concurrency=10, ~same pace as split-sentences.
 */

import { config } from "dotenv"
import { join, dirname } from "path"
import { fileURLToPath } from "url"
import { drizzle } from "drizzle-orm/mysql2"
import mysql from "mysql2/promise"
import { isNull, eq } from "drizzle-orm"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

config({ path: join(__dirname, "..", ".env.local") })

import { sentences } from "../src/lib/db/schema"
import { llmCall } from "../src/lib/llm"

const pool = mysql.createPool(process.env.DATABASE_URL!)
const db = drizzle(pool, { schema: { sentences }, mode: "default" })

type Word = { english: string; chinese: string | null; phonetic: string | null; pos: string }

const SYSTEM_PROMPT = `你是英语语言学专家。请对英文句子逐词分析，返回 JSON 数组。

每项格式：{"english":"单词","chinese":"中文释义","phonetic":"/国际音标/","pos":"词性"}

词性只能用以下之一：
名词 / 动词 / 形容词 / 副词 / 代词 / 介词 / 并列连词 / 从属连词 / 感叹词 / 限定词 / 助动词 / 情态动词 / 专有名词 / 人名 / 数词 / 助词 / 不定式 / 冠词

标点符号固定格式：{"english":".","chinese":null,"phonetic":null,"pos":"标点"}

只输出 JSON 数组，不要任何解释或 markdown。`

function extractJsonArray(raw: string): string {
  const block = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (block) return block[1].trim()
  const start = raw.indexOf("[")
  const end = raw.lastIndexOf("]")
  if (start !== -1 && end > start) return raw.slice(start, end + 1)
  return raw
}

async function analyzeWords(english: string, chinese: string): Promise<Word[]> {
  const raw = await llmCall({
    systemPrompt: SYSTEM_PROMPT,
    userMessage: `句子：${english}\n中文：${chinese}`,
    temperature: 0.2,
  })
  return JSON.parse(extractJsonArray(raw)) as Word[]
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

  const pending = await db
    .select({ id: sentences.id, english: sentences.english, chinese: sentences.chinese })
    .from(sentences)
    .where(isNull(sentences.words))

  console.log(`\n📖 Analyze Words Script`)
  console.log(`   Pending (no words): ${pending.length}`)
  console.log(`   Concurrency: ${CONCURRENCY}`)
  console.log(`   Estimated time: ~${Math.ceil(pending.length / CONCURRENCY * 8 / 60)} minutes\n`)

  if (pending.length === 0) {
    console.log("✅ All sentences already have words!")
    await pool.end()
    return
  }

  let done = 0
  let failed = 0
  const startTime = Date.now()

  await runWithConcurrency(pending, CONCURRENCY, async (s, i) => {
    try {
      const words = await analyzeWords(s.english ?? "", s.chinese ?? "")
      const wordsCount = words.filter((w) => w.pos !== "标点").length
      await db.update(sentences).set({ words, wordsCount }).where(eq(sentences.id, s.id))
      done++
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
