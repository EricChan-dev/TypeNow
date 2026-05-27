#!/usr/bin/env tsx
/**
 * Expand existing courses with more lessons and sentences.
 *
 * Run: pnpm expand-courses
 *   or: TARGET_LESSONS=30 SENTENCES_PER_LESSON=12 pnpm expand-courses
 *
 * Defaults:
 *   TARGET_LESSONS=15          — ensure each course has at least N lessons
 *   SENTENCES_PER_LESSON=10    — sentences per new lesson (10-25 words each, splittable)
 *   BATCH_LESSONS=5            — lessons per AI call (avoids huge responses)
 *   CONCURRENCY=3              — courses in parallel
 *
 * Idempotent: skips courses already at or above TARGET_LESSONS.
 */

import { config } from "dotenv"
import { join, dirname } from "path"
import { fileURLToPath } from "url"
import { randomUUID } from "crypto"
import { drizzle } from "drizzle-orm/mysql2"
import mysql from "mysql2/promise"
import { eq, count as sqlCount } from "drizzle-orm"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

config({ path: join(__dirname, "..", ".env.local") })

import { courses, lessons, sentences } from "../src/lib/db/schema"
import { llmCall } from "../src/lib/llm"

const pool = mysql.createPool(process.env.DATABASE_URL!)
const db = drizzle(pool, { schema: { courses, lessons, sentences }, mode: "default" })

const TARGET_LESSONS = Number(process.env.TARGET_LESSONS ?? 15)
const SENTENCES_PER_LESSON = Number(process.env.SENTENCES_PER_LESSON ?? 10)
const BATCH_LESSONS = Number(process.env.BATCH_LESSONS ?? 5)
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 3)

type LessonData = {
  title: string
  summary: string
  sentences: Array<{ english: string; chinese: string }>
}

function extractJsonObject(raw: string): string {
  const block = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (block) return block[1].trim()
  const start = raw.indexOf("{")
  const end = raw.lastIndexOf("}")
  if (start !== -1 && end > start) return raw.slice(start, end + 1)
  return raw
}

function buildExpandPrompt(
  courseTitle: string,
  categoryLabel: string,
  existingTitles: string[],
  batchCount: number,
  sentencesPerLesson: number
): string {
  const titlesStr = existingTitles.length
    ? `已有章节（不要重复，不要类似内容）：\n${existingTitles.map((t, i) => `${i + 1}. ${t}`).join("\n")}`
    : ""

  return `你是英语教学课程设计专家。请为课程《${courseTitle}》（${categoryLabel}）扩充 ${batchCount} 个新章节。

${titlesStr}

要求：
1. 生成 ${batchCount} 个全新章节，内容不重复，难度循序渐进
2. 每章包含 ${sentencesPerLesson} 个完整英文句子
3. 句子要求：10~25 个单词，结构丰富，包含从句/短语结构，适合练习拆分
4. 每章提供：title（简洁标题，中英文均可）、summary（1~2 句中文概括内容）
5. 中文翻译准确自然

只返回 JSON，格式：
{"lessons":[{"title":"...","summary":"...","sentences":[{"english":"...","chinese":"..."}]}]}`
}

async function generateLessons(
  courseTitle: string,
  categoryLabel: string,
  existingTitles: string[],
  batchCount: number
): Promise<LessonData[]> {
  const raw = await llmCall({
    systemPrompt: buildExpandPrompt(courseTitle, categoryLabel, existingTitles, batchCount, SENTENCES_PER_LESSON),
    userMessage: `请生成 ${batchCount} 个新章节。`,
    temperature: 0.7,
  })
  const parsed = JSON.parse(extractJsonObject(raw)) as { lessons: LessonData[] }
  return parsed.lessons
}

async function expandCourse(course: { id: string; title: string; categoryKey: string | null; subCategoryKey: string | null }): Promise<{ added: number }> {
  // Count existing lessons
  const [{ cnt }] = await db
    .select({ cnt: sqlCount() })
    .from(lessons)
    .where(eq(lessons.courseId, course.id))

  const currentCount = Number(cnt)
  if (currentCount >= TARGET_LESSONS) return { added: 0 }

  // Load existing lesson titles for dedup
  const existingLessons = await db
    .select({ title: lessons.title, sortOrder: lessons.sortOrder })
    .from(lessons)
    .where(eq(lessons.courseId, course.id))

  const existingTitles = existingLessons.map((l) => l.title)
  const maxSortOrder = existingLessons.reduce((m, l) => Math.max(m, l.sortOrder), 0)

  const needed = TARGET_LESSONS - currentCount
  const categoryLabel = [course.categoryKey, course.subCategoryKey].filter(Boolean).join(" / ") || "通用英语"

  let totalAdded = 0
  let nextSortOrder = maxSortOrder + 1
  const allTitles = [...existingTitles]

  // Generate in batches of BATCH_LESSONS
  let remaining = needed
  while (remaining > 0) {
    const batchCount = Math.min(remaining, BATCH_LESSONS)
    const newLessons = await generateLessons(course.title, categoryLabel, allTitles, batchCount)

    for (const lessonData of newLessons) {
      const lessonId = randomUUID()
      await db.insert(lessons).values({
        id: lessonId,
        courseId: course.id,
        title: lessonData.title,
        summary: lessonData.summary,
        sortOrder: nextSortOrder++,
      })

      const sentenceRows = lessonData.sentences.map((s, idx) => ({
        id: randomUUID(),
        lessonId,
        english: s.english,
        chinese: s.chinese,
        sortOrder: idx,
      }))
      if (sentenceRows.length > 0) {
        await db.insert(sentences).values(sentenceRows)
      }

      allTitles.push(lessonData.title)
      totalAdded++
    }

    remaining -= batchCount
  }

  return { added: totalAdded }
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
  const allCourses = await db
    .select({ id: courses.id, title: courses.title, categoryKey: courses.categoryKey, subCategoryKey: courses.subCategoryKey })
    .from(courses)

  console.log(`\n📚 Expand Courses Script`)
  console.log(`   Courses: ${allCourses.length}`)
  console.log(`   Target lessons per course: ${TARGET_LESSONS}`)
  console.log(`   Sentences per new lesson: ${SENTENCES_PER_LESSON}`)
  console.log(`   Batch size (lessons per AI call): ${BATCH_LESSONS}`)
  console.log(`   Concurrency: ${CONCURRENCY}\n`)

  let done = 0
  let totalAdded = 0
  let failed = 0
  const startTime = Date.now()

  await runWithConcurrency(allCourses, CONCURRENCY, async (course, i) => {
    try {
      const { added } = await expandCourse(course)
      done++
      totalAdded += added
      const label = added > 0 ? `+${added} lessons` : "already full"
      if (done % 10 === 0 || done <= 5 || added > 0) {
        console.log(`  [${done}/${allCourses.length}] ${course.title.slice(0, 40)} → ${label}`)
      }
    } catch (err) {
      failed++
      console.error(`  FAIL [${i}] ${course.title.slice(0, 40)}: ${err instanceof Error ? err.message : err}`)
    }
  })

  const elapsed = Math.round((Date.now() - startTime) / 1000)
  console.log(`\n✅ Expand complete!`)
  console.log(`   Courses processed: ${done}`)
  console.log(`   Lessons added: ${totalAdded}`)
  console.log(`   Sentences added: ~${totalAdded * SENTENCES_PER_LESSON}`)
  console.log(`   Failed: ${failed}`)
  console.log(`   Elapsed: ${Math.floor(elapsed / 60)}m ${elapsed % 60}s`)

  await pool.end()
}

main().catch((err) => {
  console.error("Fatal error:", err)
  process.exit(1)
})
