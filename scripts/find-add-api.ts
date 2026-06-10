#!/usr/bin/env tsx
/**
 * 截获"加入课程包"按钮的 API 请求
 * 打开 mall 页面，你手动点一次"加入"，脚本自动打印端点名
 */
import { config } from "dotenv"
import { join, dirname } from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
config({ path: join(dirname(__filename), "..", ".env.local") })

const C = process.env.JULEBU_COOKIE
if (!C) { console.error("❌ 请设置 JULEBU_COOKIE"); process.exit(1) }

async function main() {
  let puppeteer: typeof import("puppeteer")
  for (const p of ["puppeteer", "/tmp/puppeteer-tmp/node_modules/puppeteer"]) {
    try { puppeteer = require(p); break } catch { /* next */ }
  }
  if (!puppeteer!) { console.error("❌ puppeteer 未找到"); process.exit(1) }
  const browser = await puppeteer.launch({
    executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: false,
    args: ["--no-sandbox", "--window-size=1440,900"],
  })

  const page = (await browser.pages())[0]
  await page.setViewport({ width: 1440, height: 900 })

  // 设 cookie
  for (const pair of C!.split(";").map((c: string) => c.trim())) {
    const eq = pair.indexOf("=")
    if (eq === -1) continue
    const n = pair.slice(0, eq).trim()
    if (!n.startsWith("__Secure-julebu")) continue
    await page.setCookie({ name: n, value: pair.slice(eq + 1).trim(), domain: ".julebu.co", path: "/", secure: true, sameSite: "Lax" as const })
  }

  // 拦截所有 tRPC mutation（POST）请求
  page.on("request", (req) => {
    const url = req.url()
    if (url.includes("trpc/") && req.method() === "POST") {
      const ep = url.match(/trpc\/([^?]+)/)?.[1]
      const body = req.postData()
      if (ep && !["practice.createSession", "userLearnHistory.upsert"].includes(ep)) {
        console.log(`\n🔍 POST ${ep}`)
        console.log(`   body: ${body?.slice(0, 200)}`)
      }
    }
  })

  await page.goto("https://julebu.co/mall", { waitUntil: "networkidle2", timeout: 30000 })
  console.log("✅ Mall 页面已打开")
  console.log("\n📌 现在点任意课程包的「加入」按钮，我会打印 API 端点名")
  console.log("   完成后关闭浏览器窗口\n")

  return new Promise<void>((resolve) => {
    browser.on("disconnected", () => resolve())
  })
}

main()
