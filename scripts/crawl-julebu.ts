#!/usr/bin/env tsx
/**
 * 句乐部自动爬虫
 *
 * 用法：export JULEBU_COOKIE='...' && pnpm tsx scripts/crawl-julebu.ts
 *
 * 输出：.data/julebu/{课程包名称}.json — 每包一个文件，含全部课程+句子
 *
 * 断点续传：已爬取的课会跳过，每完成一课立即写入包文件
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"
import { config } from "dotenv"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

config({ path: join(__dirname, "..", ".env.local") })

const DATA_DIR = join(__dirname, "..", ".data", "julebu")
if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })

const JULEBU_COOKIE = process.env.JULEBU_COOKIE
const TARGET_PACKS = process.env.JULEBU_TARGET_PACKS?.split(",").map(s => s.trim()) || null

if (!JULEBU_COOKIE) { console.error("❌ 请设置 JULEBU_COOKIE"); process.exit(1) }

let puppeteer: typeof import("puppeteer")
for (const p of ["puppeteer", "/tmp/puppeteer-tmp/node_modules/puppeteer"]) {
  try { puppeteer = require(p); break } catch { /* next */ }
}
if (!puppeteer!) { console.error("❌ puppeteer 未找到"); process.exit(1) }

const H = { "accept": "*/*", "content-type": "application/json", "cookie": JULEBU_COOKIE, "Referer": "https://julebu.co/" }

async function jf<T = unknown>(endpoint: string, input: unknown = null): Promise<T | null> {
  const bi = { "0": { json: input } }
  const url = `https://api.julebu.co/trpc/${endpoint}?batch=1&input=${encodeURIComponent(JSON.stringify(bi))}`
  const r = await fetch(url, { headers: H })
  const d = await r.json() as Array<{ error?: unknown; result?: { data?: { json?: T } } }>
  if (d[0]?.error) return null
  return d[0]?.result?.data?.json ?? null
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

interface CourseInfo { id: string; title: string; order: number; sentences?: unknown[] }
interface PackInfo { id: string; title: string; courses: CourseInfo[] }

async function main() {
  console.log("🕷 句乐部自动爬虫\n")

  console.log("📡 获取课程包列表...")
  const packs: PackInfo[] = []

  if (TARGET_PACKS) {
    // 指定了课程包 → 直接获取
    for (const pid of TARGET_PACKS) {
      const d = await jf<{ title: string; courses: Array<{ id: string; title: string; order: number }> }>("mall.getCoursePackDetail", { coursePackId: pid })
      if (d?.courses) packs.push({ id: pid, title: d.title, courses: d.courses.map(c => ({ id: c.id, title: c.title, order: c.order })) })
    }
  } else if (process.env.JULEBU_ALL_PACKS) {
    // JULEBU_ALL_PACKS=1 → mall.search 拉全部
    let page = 1
    while (true) {
      const result = await jf<{ coursePacks: Array<{ id: string; title: string }>; hasNext: boolean }>("mall.search", { sortBy: "created_at", page, pageSize: 100 })
      if (!result?.coursePacks?.length) break
      for (const cp of result.coursePacks) {
        const d = await jf<{ title: string; courses: Array<{ id: string; title: string; order: number }> }>("mall.getCoursePackDetail", { coursePackId: cp.id })
        if (d?.courses?.length) packs.push({ id: cp.id, title: d.title, courses: d.courses.map(c => ({ id: c.id, title: c.title, order: c.order })) })
        await sleep(300)
      }
      console.log(`  📄 第 ${page} 页，已获取 ${packs.length} 个包`)
      if (!result.hasNext) break
      page++
    }
  } else {
    // 默认：用户已加入的课程包（可爬取）
    const userPacks = await jf<Array<{ coursePackId: string; title: string }>>("userCoursePacks.list", {})
    if (!userPacks?.length) { console.error("❌ 未找到课程包"); process.exit(1) }
    for (const up of userPacks) {
      const d = await jf<{ title: string; courses: Array<{ id: string; title: string; order: number }> }>("mall.getCoursePackDetail", { coursePackId: up.coursePackId })
      if (d?.courses) packs.push({ id: up.coursePackId, title: d.title, courses: d.courses.map(c => ({ id: c.id, title: c.title, order: c.order })) })
    }
  }

  if (!packs.length) { console.error("❌ 无课程包"); process.exit(1) }
  console.log(`📊 共 ${packs.length} 个课程包，${packs.reduce((s,p) => s + p.courses.length, 0)} 课\n`)

  // 保存元数据
  writeFileSync(join(DATA_DIR, "all-packs.json"), JSON.stringify(packs, null, 2))

  // 启动浏览器
  console.log("\n🖥 启动浏览器...")
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: false,
    args: ["--no-sandbox", "--window-size=1920,1080"],
  })

  let totalSuccess = 0

  try {
    for (const pack of packs) {
      const packFile = join(DATA_DIR, `${pack.title}.json`)

      // 加载已有数据（断点续传）
      const doneIds = new Set<string>()
      if (existsSync(packFile)) {
        const existing = JSON.parse(readFileSync(packFile, "utf-8"))
        pack.courses = existing.courses
        existing.courses.forEach((c: CourseInfo) => { if (c.sentences?.length) doneIds.add(c.id) })
        console.log(`\n📚 ${pack.title} — 已缓存 ${doneIds.size}/${pack.courses.length} 课`)
      } else {
        console.log(`\n📚 ${pack.title}`)
      }

      let changed = false
      let consecutiveFails = 0

      for (let i = 0; i < pack.courses.length; i++) {
        const course = pack.courses[i]
        if (doneIds.has(course.id)) {
          console.log(`  [${i + 1}/${pack.courses.length}] ${course.title} — 已缓存`)
          consecutiveFails = 0
          continue
        }

        // 连续3课失败 → 跳过该包（可能未购买/无权限）
        if (consecutiveFails >= 3) {
          console.log(`  ⏭ 连续 ${consecutiveFails} 课失败，跳过该包其余课程`)
          break
        }

        process.stdout.write(`  [${i + 1}/${pack.courses.length}] ${course.title} ...`)

        const page = await browser.newPage()
        let captured: unknown[] | null = null

        try {
          await page.setViewport({ width: 1920, height: 1080 })

          for (const pair of JULEBU_COOKIE!.split(";").map(c => c.trim())) {
            const eq = pair.indexOf("=")
            if (eq === -1) continue
            const n = pair.slice(0, eq).trim()
            if (!n.startsWith("__Secure-julebu")) continue
            await page.setCookie({ name: n, value: pair.slice(eq + 1).trim(), domain: ".julebu.co", path: "/", secure: true, sameSite: "Lax" as const })
          }

          page.on("response", (r) => {
            if (!r.url().includes("courses.findOne")) return
            r.text().then(text => {
              try {
                for (const item of JSON.parse(text)) {
                  const j = item?.result?.data?.json
                  if (j?.sentences?.length > 0) captured = j.sentences
                }
              } catch { /* skip */ }
            }).catch(() => {})
          })

          await page.goto(
            `https://julebu.co/game/course/${pack.id}/${course.id}?mode=chinese_to_english&presetKey=advanced`,
            { waitUntil: "networkidle2", timeout: 30000 }
          )
          await sleep(3000)
          for (let w = 0; w < 30 && !captured; w++) await sleep(500)

          if (captured) {
            course.sentences = captured
            writeFileSync(packFile, JSON.stringify({ packId: pack.id, title: pack.title, courses: pack.courses }, null, 2))
            doneIds.add(course.id)
            changed = true
            totalSuccess++
            consecutiveFails = 0
            console.log(` ✅ ${captured.length} 句`)
          } else {
            consecutiveFails++
            process.stdout.write(` ✗ 超时 (${consecutiveFails}/3)\n`)
          }
        } finally {
          await page.close()
        }

        await sleep(1500)
      }

      if (!changed && doneIds.size === pack.courses.length) {
        console.log(`  ✅ 全部已完成`)
      }
    }
  } finally {
    await browser.close()
  }

  console.log(`\n✅ 完成！数据保存在 .data/julebu/`)
}

main().catch(e => { console.error(e); process.exit(1) })
