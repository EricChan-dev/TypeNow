#!/usr/bin/env tsx
/**
 * 句乐部课程数据导入脚本 — 完整版
 *
 * 功能：
 *   Phase 1: Node.js API 拉取课程包/课程元数据
 *   Phase 2: Puppeteer 浏览器中触发 courses.findOne 提取完整句子数据
 *   Phase 3: 转换 + 写入 MySQL 数据库
 *
 * 用法：
 *   pnpm import-julebu                          # 导入全部用户课程包
 *   JULEBU_TARGET_PACKS=id1,id2 pnpm import-julebu  # 仅指定课程包
 *   JULEBU_MAX_COURSES=3 pnpm import-julebu     # 每包最多3课
 *   SKIP_PUPPETEER=1 pnpm import-julebu         # 跳过抓取，仅从缓存写入
 *   SKIP_DB=1 pnpm import-julebu                # 仅抓取不写库
 *
 * 环境变量：
 *   JULEBU_COOKIE — 句乐部登录 cookie（必需）
 *   DATABASE_URL  — MySQL 连接串（通过 .env.local 自动加载）
 *
 * 断点续传：
 *   每课数据缓存到 .data/julebu/sentences-{courseId}.json
 *   重新运行脚本时自动跳过已缓存的课程
 */

import { config } from "dotenv"
import { join, dirname } from "path"
import { fileURLToPath } from "url"
import { randomUUID } from "crypto"
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// ── Load env BEFORE imports that read process.env at init time ─────
config({ path: join(__dirname, "..", ".env.local") })

// ── Static imports (safe — no module reads process.env at init time) ──
import { drizzle } from "drizzle-orm/mysql2"
import mysql from "mysql2/promise"
import { eq } from "drizzle-orm"
import { courses, lessons, sentences } from "../src/lib/db/schema"

// ── Config ─────────────────────────────────────────────────────────

const DATA_DIR = join(__dirname, "..", ".data", "julebu")
const JULEBU_COOKIE = process.env.JULEBU_COOKIE
const TARGET_PACKS = process.env.JULEBU_TARGET_PACKS?.split(",").map(s => s.trim()).filter(Boolean)
const MAX_COURSES = Number(process.env.JULEBU_MAX_COURSES ?? 0) || Infinity
const SKIP_PUPPETEER = !!process.env.SKIP_PUPPETEER
const SKIP_DB = !!process.env.SKIP_DB

// ── Types ──────────────────────────────────────────────────────────

interface JulebuWordDetail {
  word: string
  pos: string
  phonetic: { uk: string; us: string }
  definition: string
}

interface JulebuSentence {
  id: string
  content: string
  english: string
  chinese: string
  sortOrder: number
  wordDetails: JulebuWordDetail[] | null
  dependencyAnalysis: unknown | null
  sentenceStructure: unknown[] | null
}

interface JulebuCourse {
  id: string
  title: string
  description: string | null
  order: number
}

interface JulebuPack {
  id: string
  title: string
  description: string | null
  courses?: JulebuCourse[]
}

// ── Helpers ────────────────────────────────────────────────────────

function log(icon: string, ...args: unknown[]) {
  console.log(`  ${icon}`, ...args)
}

function error(msg: string) {
  console.error(`  ✗ ${msg}`)
}

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms))
}

// ── Phase 1: Node.js tRPC API ─────────────────────────────────────

const API_HEADERS = {
  "accept": "*/*",
  "content-type": "application/json",
  "Referer": "https://julebu.co/",
}

async function julebuApi<T = unknown>(endpoint: string, input: unknown = null): Promise<T | null> {
  if (!JULEBU_COOKIE) throw new Error("JULEBU_COOKIE env var not set")

  const bi = { "0": { json: input } }
  const url = `https://api.julebu.co/trpc/${endpoint}?batch=1&input=${encodeURIComponent(JSON.stringify(bi))}`

  const res = await fetch(url, {
    headers: { ...API_HEADERS, cookie: JULEBU_COOKIE },
  })
  const data = await res.json() as Array<{ error?: unknown; result?: { data?: { json?: T } } }>

  if (data[0]?.error) {
    const err = data[0].error as { json?: { message?: string } }
    error(`[${endpoint}] ${err?.json?.message || JSON.stringify(err).slice(0, 200)}`)
    return null
  }
  return data[0]?.result?.data?.json ?? null
}

async function fetchAllPacks(useCache: boolean = false): Promise<JulebuPack[]> {
  // ── Cache fallback: read packs-metadata.json instead of hitting API ──
  if (useCache) {
    const cacheFile = join(DATA_DIR, "packs-metadata.json")
    if (existsSync(cacheFile)) {
      const cached = JSON.parse(readFileSync(cacheFile, "utf-8"))
      log("📦", `Loaded ${cached.length} packs from cache`)
      if (TARGET_PACKS) {
        const filtered = cached.filter(p => TARGET_PACKS.includes(p.id))
        if (filtered.length === 0) { error("None of TARGET_PACKS found in cached packs"); return [] }
        return filtered
      }
      return cached
    }
    error("No cached packs-metadata.json found")
    return []
  }

  log("📡", "Phase 1: Fetching pack metadata via Node.js API...")

  // Get user's course packs
  const userPacks = await julebuApi<Array<{ coursePackId: string; title: string }>>(
    "userCoursePacks.list", {},
  )
  if (!userPacks || userPacks.length === 0) {
    error("No user course packs found — is JULEBU_COOKIE valid?")
    return []
  }

  log("📦", `Found ${userPacks.length} course packs`)

  // Filter if TARGET_PACKS specified
  const filtered = TARGET_PACKS
    ? userPacks.filter(p => TARGET_PACKS.includes(p.coursePackId))
    : userPacks

  if (TARGET_PACKS && filtered.length === 0) {
    error(`None of TARGET_PACKS (${TARGET_PACKS.join(", ")}) found in user packs`)
    return []
  }

  // Get detail for each pack
  const packs: JulebuPack[] = []
  for (const up of filtered) {
    log("📚", `${up.title} (${up.coursePackId})`)
    const detail = await julebuApi<JulebuPack & { courses: JulebuCourse[] }>(
      "mall.getCoursePackDetail",
      { coursePackId: up.coursePackId },
    )
    if (!detail?.courses) {
      log("⚠", "  No courses found")
      continue
    }

    const courseCount = Math.min(detail.courses.length, MAX_COURSES)
    log("✓", `  ${detail.courses.length} courses → importing ${courseCount}`)
    packs.push({
      id: up.coursePackId,
      title: detail.title ?? up.title,
      description: detail.description ?? "",
      courses: detail.courses.slice(0, courseCount),
    })
    await sleep(500) // Rate limit
  }

  return packs
}

// ── Phase 2: Puppeteer — extract sentence data ────────────────────

async function fetchCourseSentencesPuppeteer(
  coursePackId: string,
  courseId: string,
  courseTitle: string,
): Promise<JulebuSentence[] | null> {
  const puppeteer = await import("puppeteer")

  const browser = await puppeteer.default.launch({
    executablePath: process.env.CHROME_PATH || undefined,
    headless: "new" as const,
    args: ["--no-sandbox", "--window-size=1920,1080"],
  })

  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 1920, height: 1080 })

    // ── Set cookies ──
    await page.goto("https://julebu.co/", { waitUntil: "domcontentloaded", timeout: 30000 })

    const pairs = JULEBU_COOKIE!.split(";").map(c => c.trim())
    for (const pair of pairs) {
      const eqIdx = pair.indexOf("=")
      if (eqIdx === -1) continue
      const name = pair.slice(0, eqIdx).trim()
      if (!name.startsWith("__Secure-julebu")) continue
      await page.setCookie({
        name,
        value: pair.slice(eqIdx + 1).trim(),
        domain: ".julebu.co",
        path: "/",
        secure: true,
        sameSite: "Lax" as const,
      })
    }

    // ── Navigate to pack detail page ──
    await page.goto(`https://julebu.co/my-course-packs/${coursePackId}`, {
      waitUntil: "networkidle2",
      timeout: 30000,
    })
    await sleep(4000)

    // ── Click "继续学习" button for this course ──
    const found = await page.evaluate((title: string) => {
      const buttons = document.querySelectorAll("button")
      for (const btn of buttons) {
        if (btn.textContent?.includes(title)) {
          (btn as HTMLButtonElement).click()
          return true
        }
      }
      return false
    }, courseTitle)

    if (!found) {
      error(`Button not found: "${courseTitle}"`)
      return null
    }
    await sleep(3000)

    // ── Click "继续练习" to trigger game load (which calls courses.findOne) ──
    const clicked = await page.evaluate(() => {
      const buttons = document.querySelectorAll("button")
      for (const btn of buttons) {
        const text = btn.textContent?.trim() || ""
        if (text.includes("继续练习") || text.includes("重新开始")) {
          (btn as HTMLButtonElement).click()
          return text
        }
      }
      return null
    })

    if (!clicked) {
      error("Start button not found")
      return null
    }

    // ── Wait for and capture courses.findOne response ──
    const sentencesPromise = new Promise<JulebuSentence[] | null>((resolve) => {
      const timeout = setTimeout(() => resolve(null), 25000)

      const handler = async (response: { url: () => string; text: () => Promise<string> }) => {
        if (response.url().includes("courses.findOne")) {
          try {
            const text = await response.text()
            const data = JSON.parse(text)
            for (const item of data) {
              const j = item?.result?.data?.json
              if (j?.sentences?.length > 0) {
                clearTimeout(timeout)
                page.off("response", handler)
                resolve(j.sentences)
                return
              }
            }
          } catch { /* retry */ }
        }
      }
      page.on("response", handler)
    })

    const result = await sentencesPromise

    if (result) {
      log("✓", `${result.length} sentences`)
    } else {
      error("Timeout — no courses.findOne response")
    }

    return result
  } finally {
    await browser.close()
  }
}

// ── Phase 3: Transform & Insert ───────────────────────────────────

function julebuToTypeNowRow(
  js: JulebuSentence,
  lessonId: string,
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
      phonetic: w.phonetic as unknown as string,   // {uk, us} object stored as JSON
      pos: w.pos,                                    // VERB/NOUN/PRON...
    })) ?? null,
    dependencyAnalysis: js.dependencyAnalysis as typeof sentences.$inferInsert["dependencyAnalysis"] ?? null,
    sentenceStructure: js.sentenceStructure as typeof sentences.$inferInsert["sentenceStructure"] ?? null,
  }
}

async function importPackToDB(pack: JulebuPack) {
  if (!process.env.DATABASE_URL) {
    error("DATABASE_URL not set — skipping DB import")
    return { courseId: "", lessons: 0, sentences: 0 }
  }

  const pool = mysql.createPool(process.env.DATABASE_URL)
  const db = drizzle(pool, { schema: { courses, lessons, sentences }, mode: "default" })

  try {
    // ── Check if already imported ──
    const existing = await db
      .select({ id: courses.id })
      .from(courses)
      .where(eq(courses.title, pack.title))
      .limit(1)

    if (existing.length > 0) {
      log("⏭", `Course "${pack.title}" already exists`)
      return { courseId: existing[0].id, lessons: 0, sentences: 0 }
    }

    // ── Insert Course ──
    const courseId = randomUUID()
    await db.insert(courses).values({
      id: courseId,
      title: pack.title,
      description: pack.description,
      source: "official",
      sourceName: "句乐部",
      learnerCount: 0,
      usageCount: 0,
      isPublished: 1,
    })
    log("✓", `Created course: ${pack.title}`)

    // ── Insert Lessons + Sentences ──
    let totalLessons = 0
    let totalSentences = 0

    if (!pack.courses) {
      await pool.end()
      return { courseId, lessons: 0, sentences: 0 }
    }

    for (const jCourse of pack.courses) {
      const cacheFile = join(DATA_DIR, `sentences-${jCourse.id}.json`)

      // Skip if no cached sentence data
      if (!existsSync(cacheFile)) {
        log("⚠", `  No cached data for ${jCourse.title} — skipping`)
        continue
      }

      const sData: JulebuSentence[] = JSON.parse(readFileSync(cacheFile, "utf-8"))

      const lessonId = randomUUID()
      await db.insert(lessons).values({
        id: lessonId,
        courseId,
        title: jCourse.title,
        summary: jCourse.description ?? "",
        sortOrder: jCourse.order,
      })

      for (const js of sData) {
        await db.insert(sentences).values(julebuToTypeNowRow(js, lessonId))
        totalSentences++
      }
      totalLessons++
    }

    log("✓", `Inserted: ${totalLessons} lessons, ${totalSentences} sentences`)
    return { courseId, lessons: totalLessons, sentences: totalSentences }
  } finally {
    await pool.end()
  }
}

// ── Main ───────────────────────────────────────────────────────────

async function main() {
  console.log("╔══════════════════════════════════════════╗")
  console.log("║   句乐部课程数据导入 · TypeNow Importer    ║")
  console.log("╚══════════════════════════════════════════╝\n")

  // Ensure data directory
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true })
  }

  // ── Phase 1: Get pack metadata ──
  const useCache = !JULEBU_COOKIE || SKIP_PUPPETEER
  const packs = await fetchAllPacks(useCache)
  if (packs.length === 0 && useCache && JULEBU_COOKIE) {
    console.log("📡 Retrying pack fetch via API...")
    const apiPacks = await fetchAllPacks(false)
    if (apiPacks.length > 0) { packs.push(...apiPacks) }
  }
  if (packs.length === 0) {
    console.log("\n❌ No course packs to import.")
    process.exit(1)
  }

  const totalCourses = packs.reduce((sum, p) => sum + (p.courses?.length ?? 0), 0)
  console.log(`\n📊 Summary: ${packs.length} packs, ${totalCourses} courses\n`)

  // Save metadata
  writeFileSync(join(DATA_DIR, "packs-metadata.json"), JSON.stringify(packs, null, 2))
  log("💾", "Pack metadata cached")

  // ── Phase 2: Extract sentences via Puppeteer ──
  if (SKIP_PUPPETEER) {
    console.log("\n⏭ Skipping Puppeteer (SKIP_PUPPETEER=1)")
  } else {
    console.log(`\n🖥  Phase 2: Extracting sentences via Puppeteer\n`)

    // Check if puppeteer is installed
    try {
      await import("puppeteer")
    } catch {
      console.error("❌ puppeteer not installed. Run: pnpm add -D puppeteer")
      process.exit(1)
    }

    let completed = 0
    let skipped = 0

    for (const pack of packs) {
      console.log(`\n📚 ${pack.title}`)
      if (!pack.courses) continue

      for (let i = 0; i < pack.courses.length; i++) {
        const course = pack.courses[i]
        const cacheFile = join(DATA_DIR, `sentences-${course.id}.json`)

        // Check cache
        if (existsSync(cacheFile)) {
          const cached = JSON.parse(readFileSync(cacheFile, "utf-8"))
          console.log(`  [${i + 1}/${pack.courses.length}] ${course.title} — from cache (${cached.length} sentences)`)
          skipped++
          continue
        }

        console.log(`  [${i + 1}/${pack.courses.length}] ${course.title} — fetching...`)
        const sentences = await fetchCourseSentencesPuppeteer(pack.id, course.id, course.title)

        if (sentences) {
          writeFileSync(cacheFile, JSON.stringify(sentences, null, 2))
          log("💾", `Cached ${sentences.length} sentences`)
          completed++
        }

        // Rate limit between courses
        await sleep(2000)
      }
    }

    console.log(`\n  Fetched: ${completed}, Cached: ${skipped}\n`)
  }

  // ── Phase 3: Import to Database ──
  if (SKIP_DB) {
    console.log("⏭ Skipping DB import (SKIP_DB=1)")
  } else {
    console.log("💾 Phase 3: Importing to database...\n")

    for (const pack of packs) {
      console.log(`📚 ${pack.title}`)
      const result = await importPackToDB(pack)
      if (result.courseId) {
        console.log(`   → Course ID: ${result.courseId}, Lessons: ${result.lessons}, Sentences: ${result.sentences}\n`)
      }
    }
  }

  console.log("✅ Import complete!")
}

main().catch((err) => {
  console.error("Fatal:", err)
  process.exit(1)
})
