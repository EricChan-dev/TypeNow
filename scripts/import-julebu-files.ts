#!/usr/bin/env tsx
/**
 * 句乐部课程数据导入脚本 — 文件版
 *
 * 直接从 .data/julebu/ 中的独立 JSON 文件（中文名称）导入数据库。
 * 每个 JSON 文件是一个课程包，包含 pack → courses（课）→ sentences 完整数据。
 *
 * 用法：
 *   pnpm import-julebu-files                    # 导入全部
 *   JULEBU_BATCH=100 pnpm import-julebu-files   # 每批 100 句（默认 200）
 *
 * 断点续传：
 *   每次运行会检查 courses 表标题是否已存在，已存在的课程包自动跳过。
 */

import { config } from "dotenv"
import { join, dirname } from "path"
import { fileURLToPath } from "url"
import { randomUUID } from "crypto"
import { readFileSync, existsSync, readdirSync } from "fs"
import { drizzle } from "drizzle-orm/mysql2"
import mysql from "mysql2/promise"
import { eq, sql } from "drizzle-orm"
import { courses, lessons, sentences } from "../src/lib/db/schema"

// ── Load env ──
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
config({ path: join(__dirname, "..", ".env.local") })

const DATA_DIR = join(__dirname, "..", ".data", "julebu")
const BATCH_SIZE = Number(process.env.JULEBU_BATCH ?? 200)

// ── Types ──
interface JulebuWordDetail {
  word: string; pos: string; phonetic: { uk: string; us: string }; definition: string
}
interface JulebuSentence {
  id: string; content: string; english: string; chinese: string; sortOrder: number
  wordDetails: JulebuWordDetail[] | null
  dependencyAnalysis: unknown | null
  sentenceStructure: unknown[] | null
}
interface JulebuFileCourse {
  id: string; title: string; order: number; sentences: JulebuSentence[]
}
interface JulebuPackFile {
  packId: string; title: string; courses: JulebuFileCourse[]
}

// ── Helpers ──
function log(icon: string, ...args: unknown[]) { console.log(`  ${icon}`, ...args) }

function julebuSentenceToTypeNowRow(
  js: JulebuSentence, lessonId: string
): typeof sentences.$inferInsert {
  return {
    id: randomUUID(),
    english: js.english,
    chinese: js.chinese,
    lessonId,
    sortOrder: js.sortOrder,
    words: js.wordDetails?.map(w => ({
      english: w.word,
      chinese: w.definition || null,
      phonetic: w.phonetic as unknown as string,
      pos: w.pos,
    })) ?? null,
    dependencyAnalysis: js.dependencyAnalysis as typeof sentences.$inferInsert["dependencyAnalysis"] ?? null,
    sentenceStructure: js.sentenceStructure as typeof sentences.$inferInsert["sentenceStructure"] ?? null,
  }
}

// ── Main ──
async function main() {
  console.log("╔══════════════════════════════════════════════╗")
  console.log("║  句乐部课程包文件导入 · TypeNow File Importer  ║")
  console.log("╚══════════════════════════════════════════════╝\n")

  if (!process.env.DATABASE_URL) {
    console.error("❌ DATABASE_URL not set in .env.local")
    process.exit(1)
  }

  // ── List standalone JSON files ──
  const allFiles = readdirSync(DATA_DIR)
    .filter(f => f.endsWith(".json"))
    .filter(f => !f.startsWith("sentences-"))
    .filter(f => !["all-packs.json", "packs-metadata.json"].includes(f))
    .sort()

  if (allFiles.length === 0) {
    console.error("❌ No standalone JSON files found in .data/julebu/")
    process.exit(1)
  }

  console.log(`📁 Found ${allFiles.length} course pack files\n`)

  // ── DB Pool ──
  const pool = mysql.createPool(process.env.DATABASE_URL)
  const db = drizzle(pool, { schema: { courses, lessons, sentences }, mode: "default" })

  // ── Get existing course titles (for skip) ──
  const existingRows = await db.select({ title: courses.title }).from(courses).where(eq(courses.sourceName, "句乐部"))
  const existingTitles = new Set(existingRows.map(r => r.title))
  log("📊", `${existingTitles.size} existing courses from 句乐部 in DB`)

  let imported = 0, skipped = 0, failed = 0
  let totalLessons = 0, totalSentences = 0

  for (const fn of allFiles) {
    const filePath = join(DATA_DIR, fn)

    // ── Parse file ──
    let pack: JulebuPackFile
    try {
      pack = JSON.parse(readFileSync(filePath, "utf-8"))
    } catch (e) {
      log("✗", `${fn}: parse error — ${(e as Error).message}`)
      failed++
      continue
    }

    if (!pack.title || !pack.courses?.length) {
      log("⚠", `${fn}: no title or courses, skipping`)
      skipped++
      continue
    }

    // ── Skip if already imported ──
    if (existingTitles.has(pack.title)) {
      log("⏭", `${pack.title}: already exists`)
      skipped++
      continue
    }

    // ── Insert Course ──
    const courseId = randomUUID()
    await db.insert(courses).values({
      id: courseId,
      title: pack.title,
      description: pack.title,
      source: "official",
      sourceName: "句乐部",
      learnerCount: 0,
      usageCount: 0,
      isPublished: 1,
    })
    existingTitles.add(pack.title) // avoid re-import if same title appears again

    // ── Insert Lessons + Sentences in batches ──
    let lessonCount = 0
    let sentenceCount = 0
    let batch: typeof sentences.$inferInsert[] = []

    for (const jCourse of pack.courses) {
      const lessonId = randomUUID()
      await db.insert(lessons).values({
        id: lessonId,
        courseId,
        title: jCourse.title,
        summary: "",
        sortOrder: jCourse.order,
      })
      lessonCount++

      for (const s of (jCourse.sentences ?? [])) {
        batch.push(julebuSentenceToTypeNowRow(s, lessonId))
        sentenceCount++

        if (batch.length >= BATCH_SIZE) {
          await db.insert(sentences).values(batch)
          batch = []
        }
      }

      // Flush remaining batch
      if (batch.length > 0) {
        await db.insert(sentences).values(batch)
        batch = []
      }
    }

    imported++
    totalLessons += lessonCount
    totalSentences += sentenceCount
    log("✓", `${pack.title}: ${lessonCount} lessons, ${sentenceCount} sentences`)
  }

  await pool.end()

  console.log(`\n✅ 完成！`)
  console.log(`   导入: ${imported} 个课程包, ${totalLessons} 课, ${totalSentences} 句`)
  console.log(`   跳过: ${skipped} (已存在/无效)`)
  if (failed) console.log(`   失败: ${failed}`)
}

main().catch(err => { console.error("Fatal:", err); process.exit(1) })
