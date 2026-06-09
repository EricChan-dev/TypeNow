#!/usr/bin/env tsx
/**
 * 半自动抓取脚本 — 你手动点课，脚本自动保存数据
 *
 * 用法：
 *   1. 确保 JULEBU_COOKIE 已设置
 *   2. pnpm tsx scripts/capture-julebu.ts
 *   3. Chrome 窗口会自动打开并登录 julebu.co
 *   4. 进入「我的课程包」→「星荣零基础学英语」
 *   5. 依次点击每课的「继续学习」→「继续练习」
 *   6. 终端会自动显示 ✅，数据保存到 .data/julebu/
 *   7. 全部完成后关闭 Chrome 窗口即可
 *
 * 注意：如果 puppeteer 未安装在项目里，脚本会自动从 /tmp 加载。
 *       如果遇到问题，先运行：cd /tmp && npm install puppeteer --ignore-scripts
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync } from "fs"
import { join } from "path"
import { config } from "dotenv"

config({ path: join(import.meta.dirname ?? ".", "..", ".env.local") })

const DATA_DIR = join(import.meta.dirname ?? ".", "..", ".data", "julebu")
if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })

// ── 动态加载 puppeteer ──
let puppeteer: typeof import("puppeteer")
const paths = ["puppeteer", "/tmp/puppeteer-tmp/node_modules/puppeteer"]
for (const p of paths) {
  try { puppeteer = require(p); break } catch { /* next */ }
}
if (!puppeteer!) {
  console.error("❌ puppeteer 未找到，运行: cd /tmp && npm install puppeteer --ignore-scripts")
  process.exit(1)
}

// ── 读取课程元数据 ──
interface CourseMeta { id: string; title: string }
const COURSES: CourseMeta[] = (() => {
  const metaFile = join(DATA_DIR, "packs-metadata.json")
  if (existsSync(metaFile)) {
    const packs = JSON.parse(readFileSync(metaFile, "utf-8"))
    return packs[0]?.courses ?? []
  }
  return []
})()

const JULEBU_COOKIE = process.env.JULEBU_COOKIE

async function main() {
  console.log("🕷  句乐部半自动抓取\n")
  console.log("📋 已知课程:", COURSES.length > 0 ? `${COURSES.length} 课` : "无")
  console.log("📁 数据目录:", DATA_DIR)

  // 检查已缓存
  const cached = new Set<string>()
  for (const c of COURSES) {
    if (existsSync(join(DATA_DIR, `sentences-${c.id}.json`))) cached.add(c.id)
  }
  if (cached.size > 0) console.log(`✅ 已缓存 ${cached.size}/${COURSES.length} 课，将自动跳过`)

  console.log("\n" + "═".repeat(55))
  console.log("操作：依次点击每课的「继续学习」→「继续练习」")
  console.log("完成后关闭 Chrome 窗口即可")
  console.log("═".repeat(55) + "\n")

  // 启动浏览器（可见模式）
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: false,
    args: ["--no-sandbox", "--window-size=1440,900"],
  })

  const page = (await browser.pages())[0] ?? (await browser.newPage())
  await page.setViewport({ width: 1440, height: 900 })

  // 注入 cookie
  if (JULEBU_COOKIE) {
    for (const pair of JULEBU_COOKIE.split(";").map(c => c.trim())) {
      const eq = pair.indexOf("=")
      if (eq === -1) continue
      const n = pair.slice(0, eq).trim()
      if (!n.startsWith("__Secure-julebu")) continue
      await page.setCookie({ name: n, value: pair.slice(eq + 1).trim(), domain: ".julebu.co", path: "/", secure: true, sameSite: "Lax" as const })
    }
    console.log("✅ Cookie 已注入\n")
  } else {
    console.log("⚠ 未设置 JULEBU_COOKIE，请在浏览器中手动登录\n")
  }

  // ── 拦截 courses.findOne 响应 ──
  let count = 0

  page.on("response", async (r) => {
    if (!r.url().includes("courses.findOne")) return
    try {
      const text = await r.text()
      const data = JSON.parse(text)
      for (const item of data) {
        const j = item?.result?.data?.json
        if (!j?.sentences?.length) continue
        if (cached.has(j.id)) continue

        writeFileSync(join(DATA_DIR, `sentences-${j.id}.json`), JSON.stringify(j.sentences, null, 2))
        cached.add(j.id)
        count++
        console.log(`  ✅ [${count}] ${j.title || "?"} — ${j.sentences.length} 句 (${cached.size}/${COURSES.length || "?"})`)
      }
    } catch { /* skip parse errors */ }
  })

  // 导航到首页
  await page.goto("https://julebu.co/home", { waitUntil: "networkidle2", timeout: 30000 })
  console.log("✅ 浏览器已就绪，开始操作吧\n")

  // 等待浏览器关闭
  return new Promise<void>((resolve) => {
    browser.on("disconnected", () => {
      console.log(`\n👋 完成！本次抓取: ${count} 课，总缓存: ${cached.size}`)
      resolve()
    })
  })
}

main().catch((err) => { console.error(err); process.exit(1) })
