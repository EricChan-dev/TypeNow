#!/usr/bin/env tsx
/**
 * Batch AI-split all sentences that have no chunks yet.
 * Run: pnpm split-sentences
 *
 * Uses concurrency=10 to finish ~7000 sentences in ~1-2 hours.
 * Idempotent: skips sentences that already have chunks.
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

// ─── Split prompt (mirrors /api/admin/sentences/[id]/split) ──────────────────
function buildSplitPrompt(wordCount: number): string {
  let range: string
  if (wordCount <= 6) range = "3~5"
  else if (wordCount <= 12) range = "5~7"
  else if (wordCount <= 20) range = "6~9"
  else range = "8~13"

  return `你是英语教学专家。请将下面的英文句子拆解为 ${range} 个短语，帮助学习者从部分到整体地理解和练习。

拆解逻辑（重要）：
- 不是从左到右逐字递增，而是先提取句子的各个语义成分，再逐步组合成完整句
- 先出现句子的关键词或核心短语（名词短语、动词短语、插入语等）
- 再将各成分拼合，最终还原完整句子
- 每一步都是一个独立可读的短语，有完整意义

示例（仅供参考拆解思路，不要照抄）：
原句：Excuse me, do you have this shirt?
拆解：
1. Excuse me（插入语）
2. shirt（核心名词）
3. this shirt（名词短语）
4. do you have（核心疑问结构）
5. do you have this shirt（完整疑问句）
6. Excuse me, do you have this shirt?（完整句）

规则：
1. 短语数量尽量接近区间上限 ${range}，不要只给最少数量
2. 最后一个短语必须与原句完全一致（包括标点）
3. 每个短语附带准确的中文翻译

返回纯 JSON 数组，每项格式：{"order":1,"text":"短语原文","chinese":"对应中文"}
只输出 JSON 数组，不要任何解释。`
}

function extractJsonArray(raw: string): string {
  const block = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (block) return block[1].trim()
  const start = raw.indexOf("[")
  const end = raw.lastIndexOf("]")
  if (start !== -1 && end > start) return raw.slice(start, end + 1)
  return raw
}

type Chunk = { order: number; text: string; chinese: string }

async function splitSentence(id: string, english: string, chinese: string): Promise<Chunk[]> {
  const wordCount = english.trim().split(/\s+/).length
  const raw = await llmCall({
    systemPrompt: buildSplitPrompt(wordCount),
    userMessage: `句子：${english}\n中文：${chinese}`,
    temperature: 0.3,
  })
  return JSON.parse(extractJsonArray(raw)) as Chunk[]
}

// ─── Concurrency helper ───────────────────────────────────────────────────────
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

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const CONCURRENCY = 10

  // Fetch all sentences without chunks
  const pending = await db
    .select({ id: sentences.id, english: sentences.english, chinese: sentences.chinese })
    .from(sentences)
    .where(isNull(sentences.chunks))

  console.log(`\n🔪 Split Sentences Script`)
  console.log(`   Pending (no chunks): ${pending.length}`)
  console.log(`   Concurrency: ${CONCURRENCY}`)
  console.log(`   Estimated time: ~${Math.ceil(pending.length / CONCURRENCY * 8 / 60)} minutes\n`)

  if (pending.length === 0) {
    console.log("✅ All sentences already have chunks!")
    await pool.end()
    return
  }

  let done = 0
  let failed = 0
  const startTime = Date.now()

  await runWithConcurrency(pending, CONCURRENCY, async (s, i) => {
    try {
      const chunks = await splitSentence(s.id, s.english ?? "", s.chinese ?? "")
      await db.update(sentences).set({ chunks }).where(eq(sentences.id, s.id))
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
  console.log(`\n✅ Split complete!`)
  console.log(`   Done:    ${done}`)
  console.log(`   Failed:  ${failed}`)
  console.log(`   Elapsed: ${Math.floor(elapsed / 60)}m ${elapsed % 60}s`)

  await pool.end()
}

main().catch((err) => {
  console.error("Fatal error:", err)
  process.exit(1)
})
