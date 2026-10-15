#!/usr/bin/env tsx
/**
 * 合并过小的课时（每节句子数 < 目标），把每节课补到 50-100 句的合理规模。
 *
 * Run: npx tsx scripts/merge-lessons.ts [--scope=课程标题LIKE子串] [--min=50] [--max=120] [--apply]
 *   默认 dry：只打印合并方案预览，不写库。--apply 才落库。
 *
 * 背景（用户反馈 m22914）：基准实现源文件把课程切得很细（每个 Unit 的
 * 单词/例句/分段各成一节），早期导入脚本 1:1 保留，导致 79% 的
 * 课时不足 31 句（6,904 节 ≤10 句 + 6,455 节 11-30 句）。
 *
 * 分组算法（unit 感知，避免把同一个 Unit 拆到两节）：
 *   1. 课程内按 lessons.sortOrder 顺序，先用标题里的 Unit/Module/Starter/
 *      Review/Recycle 前缀聚出「单元组」（连续同前缀才归一组 —— 课本同步
 *      先排完所有单词再排所有例句，同一 Unit 会出现两次）；
 *   2. 再把相邻的单元组贪心累加到 ≥min；单节已 ≥max 的原样保留；
 *      结尾剩余 <min/2 并入前一桶，否则独立成节。
 * 合并动作（--apply）：
 *   - 句子 lesson_id 改挂到组内第一节（sort_order 按原顺序重排）
 *   - practice_sessions / sentence_favorites / material_imports 的 lesson_id 同步改挂
 *   - 幸存课时标题：单单元组取成员标题公共前缀；跨单元组取「Unit 1-Unit 2」；
 *     都取不到回退「第X-Y节」
 *   - 其余课时软删（deleted_at=NOW(), deleted_batch=merge-<ts>），课程内 sort_order 重排
 */

import { config } from "dotenv"
import { join, dirname } from "path"
import { fileURLToPath } from "url"
import { drizzle } from "drizzle-orm/mysql2"
import mysql from "mysql2/promise"
import { eq, and, isNull, asc, like, sql, inArray } from "drizzle-orm"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
config({ path: join(__dirname, "..", ".env.local") })

import { sentences, lessons, courses, practiceSessions, sentenceFavorites, materialImports } from "../src/lib/db/schema"

const pool = mysql.createPool(process.env.DATABASE_URL!)
const db = drizzle(pool, { mode: "default" })

const args = process.argv.slice(2)
const APPLY = args.includes("--apply")
const scopeArg = args.find((a) => a.startsWith("--scope="))
const scope = scopeArg ? scopeArg.split("=")[1] : null
const MIN = Number(args.find((a) => a.startsWith("--min="))?.split("=")[1] ?? 50)
const MAX = Number(args.find((a) => a.startsWith("--max="))?.split("=")[1] ?? 120)

interface LessonRow { id: string; title: string; sortOrder: number; count: number }
type UnitGroup = LessonRow[]
type Bucket = UnitGroup[]

/** 标题里的单元前缀（小写归一）；取不到返回 null。 */
function unitKey(title: string): string | null {
  const m = title.match(/^\s*(starter\s*unit\s*\d+|unit\s*\d+|module\s*\d+|review\s*units?\s*\d+(?:\s*[-—~至到]\s*\d+)?|recycle\s*\d+)/i)
  return m ? m[1].toLowerCase().replace(/\s+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : null
}

/** 组成员标题的最长公共前缀（≥3 字符才有意义），截掉尾部残留连接符。 */
function commonPrefix(titles: string[]): string {
  if (titles.length === 1) return titles[0].replace(/[-—-\s]*【[^】]*】\s*$/, "")
  let prefix = titles[0]
  for (const t of titles.slice(1)) {
    let i = 0
    while (i < prefix.length && i < t.length && prefix[i] === t[i]) i++
    prefix = prefix.slice(0, i)
  }
  prefix = prefix.replace(/[\s\-—-]*[【(（]?\s*$/, "").trim()
  return prefix.length >= 3 ? prefix : ""
}

/** 桶标题：单单元组用公共前缀；跨单元组用「Unit 1-Unit 2」；兜底「第X-Y节」。 */
function bucketTitle(bucket: Bucket, fallbackStart: number, fallbackEnd: number): string {
  if (bucket.length === 1) {
    const p = commonPrefix(bucket[0].map((l) => l.title))
    if (p) return p
  }
  const keys = bucket.map((g) => unitKey(g[0].title)).filter((k): k is string => k !== null)
  if (keys.length >= 2) return `${keys[0]}-${keys[keys.length - 1]}`
  return `第${fallbackStart + 1}-${fallbackEnd + 1}节`
}

async function main(): Promise<void> {
  const courseRows = scope
    ? await db.select({ id: courses.id, title: courses.title }).from(courses)
        .where(and(isNull(courses.deletedAt), like(courses.title, `%${scope}%`)))
    : await db.select({ id: courses.id, title: courses.title }).from(courses)
        .where(isNull(courses.deletedAt))

  console.log(`\n📚 Merge Lessons ${APPLY ? "(APPLY)" : "(DRY 预览)"}`)
  console.log(`   Scope: ${scope ?? "全库"}  课程数: ${courseRows.length}`)
  console.log(`   目标: 每节 ≥${MIN} 句（单节 ≥${MAX} 不拆）\n`)

  let totalBuckets = 0
  let totalSaved = 0
  const coursePlans: Array<{ 课程: string; 现有课时: number; 合并后: number }> = []
  let previewPrinted = 0

  for (const course of courseRows) {
    const lessonRows = (await db
      .select({ id: lessons.id, title: lessons.title, sortOrder: lessons.sortOrder })
      .from(lessons)
      .where(and(eq(lessons.courseId, course.id), isNull(lessons.deletedAt)))
      .orderBy(asc(lessons.sortOrder))) as Array<{ id: string; title: string; sortOrder: number }>
    if (lessonRows.length === 0) continue

    // 每课时句子数：一次 GROUP BY 聚合（相关子查询在 drizzle 渲染下不可靠）
    const countRows = await db
      .select({ lessonId: sentences.lessonId, n: sql<number>`COUNT(*)` })
      .from(sentences)
      .innerJoin(lessons, eq(sentences.lessonId, lessons.id))
      .where(and(isNull(sentences.deletedAt), eq(lessons.courseId, course.id)))
      .groupBy(sentences.lessonId)
    const countMap = new Map(countRows.map((r) => [r.lessonId, Number(r.n)]))
    const rows: LessonRow[] = lessonRows.map((l) => ({ ...l, count: countMap.get(l.id) ?? 0 }))
    const totalSentences = rows.reduce((a, r) => a + r.count, 0)

    // 1) 连续同单元前缀 → 单元组
    const unitGroups: UnitGroup[] = []
    for (const l of rows) {
      const key = unitKey(l.title)
      const prev = unitGroups[unitGroups.length - 1]
      if (prev && key !== null && key === unitKey(prev[0].title)) prev.push(l)
      else unitGroups.push([l])
    }

    // 2) 相邻单元组贪心成桶（≥MIN 收口；单组 ≥MAX 独立）
    const buckets: Bucket[] = []
    let current: Bucket = []
    let currentCount = 0
    for (const g of unitGroups) {
      const gCount = g.reduce((a, l) => a + l.count, 0)
      if (gCount >= MAX && current.length === 0) {
        buckets.push([g])
        continue
      }
      current.push(g)
      currentCount += gCount
      if (currentCount >= MIN) {
        buckets.push(current)
        current = []
        currentCount = 0
      }
    }
    if (current.length > 0) {
      if (buckets.length > 0 && currentCount < MIN / 2) buckets[buckets.length - 1].push(...current)
      else buckets.push(current)
    }

    const mergedBuckets = buckets.filter((b) => b.length > 1)
    if (mergedBuckets.length === 0) continue

    coursePlans.push({ 课程: course.title, 现有课时: rows.length, 合并后: buckets.length })
    totalBuckets += mergedBuckets.length
    totalSaved += rows.length - buckets.length

    if (APPLY) {
      const batch = `merge-${Date.now()}-${course.id.slice(0, 8)}`
      for (const bucket of mergedBuckets) {
        const flat = bucket.flat()
        const survivor = flat[0]
        const absorbIds = flat.slice(1).map((l) => l.id)
        // 1) 句子改挂 + 重排 sort_order（组内按 原lesson.sortOrder, 原 sentence.sortOrder）
        let order = 0
        for (const l of flat) {
          const ids = (await db
            .select({ id: sentences.id })
            .from(sentences)
            .where(and(eq(sentences.lessonId, l.id), isNull(sentences.deletedAt)))
            .orderBy(asc(sentences.sortOrder))).map((r) => r.id)
          for (const sid of ids) {
            await db
              .update(sentences)
              .set(l.id === survivor.id ? { sortOrder: order++ } : { lessonId: survivor.id, sortOrder: order++ })
              .where(eq(sentences.id, sid))
          }
        }
        // 2) 练习历史/收藏/导入记录改挂
        await db.update(practiceSessions).set({ lessonId: survivor.id }).where(inArray(practiceSessions.lessonId, absorbIds))
        await db.update(sentenceFavorites).set({ lessonId: survivor.id }).where(inArray(sentenceFavorites.lessonId, absorbIds))
        await db.update(materialImports).set({ lessonId: survivor.id }).where(inArray(materialImports.lessonId, absorbIds))
        // 3) 幸存者标题 + 其余软删
        const newTitle = bucketTitle(bucket, survivor.sortOrder, flat[flat.length - 1].sortOrder)
        await db.update(lessons).set({ title: newTitle }).where(eq(lessons.id, survivor.id))
        await db.update(lessons).set({ deletedAt: new Date(), deletedBatch: batch }).where(inArray(lessons.id, absorbIds))
      }
      // 4) 课程内课时 sort_order 重排
      const remaining = await db.select({ id: lessons.id, sortOrder: lessons.sortOrder }).from(lessons)
        .where(and(eq(lessons.courseId, course.id), isNull(lessons.deletedAt)))
        .orderBy(asc(lessons.sortOrder))
      let order = 0
      for (const l of remaining) await db.update(lessons).set({ sortOrder: order++ }).where(eq(lessons.id, l.id))
      console.log(`  ✓ ${course.title}: ${rows.length} → ${buckets.length} 节`)
    } else if (previewPrinted < 4) {
      // DRY：只展开前 4 门课程的分桶预览，其余只进汇总表
      previewPrinted++
      console.log(`  ◇ ${course.title}（${rows.length} 节/${totalSentences} 句 → ${buckets.length} 节）`)
      for (const b of buckets.slice(0, 6)) {
        const flat = b.flat()
        const total = flat.reduce((a, l) => a + l.count, 0)
        const t = bucketTitle(b, flat[0].sortOrder, flat[flat.length - 1].sortOrder)
        console.log(`      节(${flat.length}小节/${total}句) 「${t.slice(0, 46)}」 ← ${flat[0].title.slice(0, 24)} … ${flat[flat.length - 1].title.slice(0, 24)}`)
      }
      if (buckets.length > 6) console.log(`      … 共 ${buckets.length} 节`)
    }
  }

  console.log(`\n${APPLY ? "✅" : "📋"} 完成${APPLY ? "" : "（预览，未写库）"}`)
  console.log(`   合并出 ${totalBuckets} 个跨小节的新课时，课程总课时净减 ${totalSaved} 节`)
  console.table(coursePlans.sort((a, b) => b.现有课时 - a.现有课时).slice(0, 15))

  await pool.end()
}

main().catch((err) => {
  console.error("Fatal error:", err)
  process.exit(1)
})
