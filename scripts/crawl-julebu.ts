#!/usr/bin/env tsx
/**
 * 句乐部自动爬虫 — 无需手动操作
 *
 * 用法：
 *   export JULEBU_COOKIE='...'
 *   JULEBU_TARGET_PACKS=id1,id2 pnpm tsx scripts/crawl-julebu.ts
 *
 * 原理：
 *   每课独立 page → 设 cookie → 导航到课程包页 → 点继续学习 → 点继续练习
 *   → page.on("response") 拦截 courses.findOne → 保存到 .data/julebu/
 *
 * 每课约 15-20 秒，61 课约 15 分钟，支持断点续传。
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync } from "fs"
import { join } from "path"
import { config } from "dotenv"

config({ path: join(import.meta.dirname ?? ".", "..", ".env.local") })

const DATA_DIR = join(import.meta.dirname ?? ".", "..", ".data", "julebu")
if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })

const JULEBU_COOKIE = process.env.JULEBU_COOKIE
const TARGET_PACKS = process.env.JULEBU_TARGET_PACKS?.split(",").map(s => s.trim()) || null // null = 全部

if (!JULEBU_COOKIE) { console.error("❌ 请设置 JULEBU_COOKIE"); process.exit(1) }

// 动态加载 puppeteer
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

async function main() {
  console.log("🕷 句乐部自动爬虫\n")

  // 获取课程列表（默认全部用户课程包，可通过 JULEBU_TARGET_PACKS 筛选）
  console.log("📡 获取课程列表...")
  let targetIds: string[] | null = TARGET_PACKS

  // 如果未指定，自动获取全部用户课程包
  if (!targetIds) {
    const userPacks = await jf<Array<{ coursePackId: string; title: string }>>("userCoursePacks.list", {})
    if (userPacks?.length) {
      targetIds = userPacks.map(p => p.coursePackId)
      console.log(`  找到 ${targetIds.length} 个课程包:`)
      userPacks.forEach(p => console.log(`    - ${p.title} (${p.coursePackId})`))
    } else {
      console.error("❌ 未找到任何课程包，请检查 cookie 是否有效")
      process.exit(1)
    }
  }

  const packs = []
  for (const pid of targetIds) {
    const d = await jf<{ title: string; courses: Array<{ id: string; title: string; order: number }> }>("mall.getCoursePackDetail", { coursePackId: pid })
    if (!d?.courses) { console.log(`  ⚠ ${pid} 未找到`); continue }
    console.log(`  📦 ${d.title}: ${d.courses.length} 课`)
    packs.push({ id: pid, title: d.title, courses: d.courses })
  }
  if (!packs.length) { console.error("❌ 无课程包"); process.exit(1) }
  writeFileSync(join(DATA_DIR, "packs-metadata.json"), JSON.stringify(packs, null, 2))

  // 启动浏览器
  console.log("\n🖥 启动浏览器...")
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: "new" as const,
    args: ["--no-sandbox", "--window-size=1920,1080"],
  })

  let success = 0, skipped = 0, failed = 0

  try {
    for (const pack of packs) {
      console.log(`\n📚 ${pack.title}`)

      for (let i = 0; i < pack.courses.length; i++) {
        const course = pack.courses[i]
        const cacheFile = join(DATA_DIR, `sentences-${course.id}.json`)

        if (existsSync(cacheFile)) {
          console.log(`  [${i + 1}/${pack.courses.length}] ${course.title} — 已缓存`)
          skipped++; continue
        }

        process.stdout.write(`  [${i + 1}/${pack.courses.length}] ${course.title} ...`)

        // ── 每课独立 page ──
        const page = await browser.newPage()
        let captured: unknown[] | null = null

        try {
          await page.setViewport({ width: 1920, height: 1080 })

          // 设 cookie
          for (const pair of JULEBU_COOKIE!.split(";").map(c => c.trim())) {
            const eq = pair.indexOf("=")
            if (eq === -1) continue
            const n = pair.slice(0, eq).trim()
            if (!n.startsWith("__Secure-julebu")) continue
            await page.setCookie({ name: n, value: pair.slice(eq + 1).trim(), domain: ".julebu.co", path: "/", secure: true, sameSite: "Lax" as const })
          }

          // 🎯 响应拦截器（必须在导航之前设置）
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

          // 导航到课程包页
          await page.goto(`https://julebu.co/my-course-packs/${pack.id}`, { waitUntil: "networkidle2", timeout: 30000 })

          // 等待"继续学习"按钮出现
          try {
            await page.waitForFunction(
              () => Array.from(document.querySelectorAll("button")).some(b => (b.textContent || "").includes("继续学习") && b.getBoundingClientRect().width > 0),
              { timeout: 15000 }
            )
          } catch { process.stdout.write(" ⚠ 页面加载慢\n"); }

          await sleep(4000)

          // 点"继续学习「第X课」"
          const found = await page.evaluate((title: string) => {
            for (const b of document.querySelectorAll("button")) {
              if ((b.textContent || "").includes("继续学习") && (b.textContent || "").includes(title)) { (b as HTMLButtonElement).click(); return true }
            }
            return false
          }, course.title)

          if (!found) { process.stdout.write(" ✗ 按钮\n"); failed++; continue }
          await sleep(5000)

          // 点"继续练习"/"重新开始"
          const clicked = await page.evaluate(() => {
            for (const b of document.querySelectorAll("button")) {
              const t = b.textContent?.trim() || ""
              if (t.includes("继续练习") || t.includes("重新开始")) { (b as HTMLButtonElement).click(); return t }
            }
            return null
          })

          if (!clicked) { process.stdout.write(" ✗ 无开始\n"); failed++; continue }

          // 轮询等待拦截结果
          for (let w = 0; w < 60 && !captured; w++) await sleep(500)

          if (captured) {
            writeFileSync(cacheFile, JSON.stringify(captured, null, 2))
            console.log(` ✅ ${captured.length} 句`)
            success++
          } else {
            process.stdout.write(" ✗ 超时\n")
            failed++
          }
        } finally {
          await page.close()
        }

        await sleep(1500)
        if (failed > 5 && success === 0) { console.log("\n⚠ 连续失败，cookie 可能过期"); break }
      }
    }
  } finally {
    await browser.close()
  }

  console.log(`\n✅ 完成！成功: ${success}, 跳过: ${skipped}, 失败: ${failed}`)
  if (success > 0) console.log("下一步: SKIP_PUPPETEER=1 pnpm import-julebu")
}

main().catch(e => { console.error(e); process.exit(1) })
