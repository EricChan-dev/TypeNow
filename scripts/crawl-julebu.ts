#!/usr/bin/env tsx
/**
 * 句乐部课程数据爬取脚本
 *
 * 用法：pnpm tsx scripts/crawl-julebu.ts
 *
 * 环境变量：
 *   JULEBU_COOKIE — 句乐部登录 cookie（必需）
 *   JULEBU_TARGET_PACKS — 目标课程包 ID，逗号分隔（默认：rwtocajplud9ld732ep5u8ec 星荣零基础）
 *
 * 输出：.data/julebu/sentences-{courseId}.json
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs"
import { join } from "path"
import { config } from "dotenv"

config({ path: join(import.meta.dirname ?? ".", "..", ".env.local") })

const DATA_DIR = join(import.meta.dirname ?? ".", "..", ".data", "julebu")
const JULEBU_COOKIE = process.env.JULEBU_COOKIE
const TARGET_PACKS = (process.env.JULEBU_TARGET_PACKS || "rwtocajplud9ld732ep5u8ec").split(",").map(s => s.trim())

if (!JULEBU_COOKIE) {
  console.error("❌ 请设置 JULEBU_COOKIE 环境变量")
  console.error("   export JULEBU_COOKIE='...'")
  process.exit(1)
}

// ── TypeScript 声明（动态导入 puppeteer） ──
declare function require(name: string): unknown
type PuppeteerModule = typeof import("puppeteer")

// ── tRPC API 辅助函数 ──
const H = {
  "accept": "*/*",
  "content-type": "application/json",
  "cookie": JULEBU_COOKIE,
  "Referer": "https://julebu.co/",
}

async function julebuApi<T = unknown>(endpoint: string, input: unknown = null): Promise<T | null> {
  const bi = { "0": { json: input } }
  const url = `https://api.julebu.co/trpc/${endpoint}?batch=1&input=${encodeURIComponent(JSON.stringify(bi))}`
  const r = await fetch(url, { headers: H })
  const d = await r.json() as Array<{ error?: unknown; result?: { data?: { json?: T } } }>
  if (d[0]?.error) {
    const err = d[0].error as { json?: { message?: string } }
    console.error(`  ERR [${endpoint}]: ${err?.json?.message || JSON.stringify(err).slice(0, 200)}`)
    return null
  }
  return d[0]?.result?.data?.json ?? null
}

async function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms))
}

// ── 主流程 ──
async function main() {
  console.log("🕷  句乐部课程爬虫\n")

  // 确保数据目录存在
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })

  // 动态加载 puppeteer（尝试多个路径）
  let puppeteer: PuppeteerModule
  const PUPPETEER_PATHS = [
    "puppeteer",
    "/tmp/puppeteer-tmp/node_modules/puppeteer",
  ]
  let loaded = false
  for (const p of PUPPETEER_PATHS) {
    try {
      puppeteer = require(p) as PuppeteerModule
      loaded = true
      break
    } catch { /* try next */ }
  }
  if (!loaded) {
    console.error("❌ puppeteer 未安装")
    console.error("   尝试：cd /tmp && npm install puppeteer --ignore-scripts")
    process.exit(1)
  }

  // ── Phase 1: 获取课程列表 ──
  console.log("📡 获取课程列表...")
  const packs = []
  for (const packId of TARGET_PACKS) {
    const detail = await julebuApi<{
      id: string; title: string; description: string;
      courses: Array<{ id: string; title: string; description: string | null; order: number }>
    }>("mall.getCoursePackDetail", { coursePackId: packId })
    if (!detail?.courses) {
      console.error(`  ⚠ 未找到课程包: ${packId}`)
      continue
    }
    console.log(`  📦 ${detail.title}: ${detail.courses.length} 课`)
    packs.push({ id: packId, title: detail.title, courses: detail.courses })
  }

  if (packs.length === 0) {
    console.error("❌ 没有可导入的课程包")
    process.exit(1)
  }

  // 保存元数据
  writeFileSync(join(DATA_DIR, "packs-metadata.json"), JSON.stringify(packs, null, 2))

  // ── Phase 2: 启动浏览器 ──
  console.log("\n🖥  启动浏览器...")
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: "new" as const,
    args: ["--no-sandbox", "--window-size=1920,1080"],
  })

  try {
    for (const pack of packs) {
      console.log(`\n📚 ${pack.title}`)

      for (let i = 0; i < pack.courses.length; i++) {
        const course = pack.courses[i]
        const cacheFile = join(DATA_DIR, `sentences-${course.id}.json`)

        // 跳过已缓存
        if (existsSync(cacheFile)) {
          const cached = JSON.parse(readFileSync(cacheFile, "utf-8"))
          console.log(`  [${i + 1}/${pack.courses.length}] ${course.title} — ✅ 已缓存 (${cached.length} 句)`)
          continue
        }

        process.stdout.write(`  [${i + 1}/${pack.courses.length}] ${course.title} ...`)

        // ── 为每课创建独立 page ──
        const page = await browser.newPage()
        try {
          await page.setViewport({ width: 1920, height: 1080 })

          // 设置 cookie（不要 decodeURIComponent！保持原始值）
          const pairs = JULEBU_COOKIE!.split(";").map(c => c.trim())
          for (const pair of pairs) {
            const eq = pair.indexOf("=")
            if (eq === -1) continue
            const name = pair.slice(0, eq).trim()
            if (!name.startsWith("__Secure-julebu")) continue
            await page.setCookie({
              name,
              value: pair.slice(eq + 1).trim(),  // ⚠️ 保持原始 URL-encoded 值
              domain: ".julebu.co",
              path: "/",
              secure: true,
              sameSite: "Lax" as const,
            })
          }

          // 导航到课程包详情页
          await page.goto(`https://julebu.co/my-course-packs/${pack.id}`, {
            waitUntil: "networkidle2",
            timeout: 30000,
          })

          // 等待课程按钮渲染（最多 15 秒）
          try {
            await page.waitForFunction(
              () => {
                const btns = document.querySelectorAll("button")
                return Array.from(btns).some(
                  b => (b.textContent || "").includes("继续学习") && b.getBoundingClientRect().width > 0
                )
              },
              { timeout: 15000 }
            )
          } catch {
            console.log(" ✗ 页面加载超时")
            continue
          }

          await sleep(3000)

          // ── 🎯 提前设置响应拦截器（在所有点击之前） ──
          let capturedSentences: unknown[] | null = null
          const responseHandler = (response: { url(): string; text(): Promise<string> }) => {
            const url = response.url()
            // 拦截所有 tRPC 响应用于调试
            if (url.includes("courses.findOne") || url.includes("practice.")) {
              response.text().then(text => {
                try {
                  const d = JSON.parse(text)
                  if (url.includes("courses.findOne")) {
                    for (const item of d) {
                      const j = item?.result?.data?.json
                      if (j?.sentences?.length > 0) {
                        capturedSentences = j.sentences
                      }
                    }
                  }
                } catch { /* ignore */ }
              }).catch(() => {})
            }
          }
          page.on("response", responseHandler)

          // ── 点击"继续学习「第X课」" ──
          const found = await page.evaluate((title: string) => {
            const btns = document.querySelectorAll("button")
            for (const b of btns) {
              if ((b.textContent || "").includes("继续学习") && (b.textContent || "").includes(title)) {
                ;(b as HTMLButtonElement).click()
                return true
              }
            }
            return false
          }, course.title)

          if (!found) {
            page.off("response", responseHandler)
            console.log(" ✗ 找不到按钮")
            continue
          }

          await sleep(6000)

          // ── 点击"继续练习" / "重新开始" ──
          const clicked = await page.evaluate(() => {
            const btns = document.querySelectorAll("button")
            for (const b of btns) {
              const t = b.textContent?.trim() || ""
              if (t.includes("继续练习") || t.includes("重新开始")) {
                ;(b as HTMLButtonElement).click()
                return t
              }
            }
            return null
          })

          if (!clicked) {
            page.off("response", responseHandler)
            console.log(" ✗ 找不到开始按钮")
            continue
          }

          // ── 等待 courses.findOne 响应（轮询，最多 30 秒） ──
          for (let w = 0; w < 60; w++) {
            if (capturedSentences) break
            await sleep(500)
          }
          page.off("response", responseHandler)

          if (capturedSentences && capturedSentences.length > 0) {
            writeFileSync(cacheFile, JSON.stringify(capturedSentences, null, 2))
            console.log(` ✅ ${capturedSentences.length} 句`)
          } else {
            console.log(" ✗ 无数据")
          }
        } finally {
          await page.close()
        }

        await sleep(2000) // 请求间隔
      }
    }
  } finally {
    await browser.close()
  }

  console.log("\n✅ 爬取完成！数据缓存于 .data/julebu/")
  console.log("   下一步：SKIP_PUPPETEER=1 pnpm import-julebu")
}

main().catch((err) => {
  console.error("Fatal:", err)
  process.exit(1)
})
