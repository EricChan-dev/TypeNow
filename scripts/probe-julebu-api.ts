#!/usr/bin/env tsx
/**
 * 探测句乐部"添加课程包"的 API v2
 */
import { config } from "dotenv"
import { join, dirname } from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
config({ path: join(dirname(__filename), "..", ".env.local") })

const C = process.env.JULEBU_COOKIE
if (!C) { console.error("❌ 请设置 JULEBU_COOKIE"); process.exit(1) }

const H = { "accept": "*/*", "content-type": "application/json", "cookie": C, "Referer": "https://julebu.co/" }

async function jf<T = unknown>(endpoint: string, input: unknown = null, method = "GET"): Promise<T | null> {
  const bi = { "0": { json: input } }
  const url = `https://api.julebu.co/trpc/${endpoint}?batch=1${method === "POST" ? "" : "&input=" + encodeURIComponent(JSON.stringify(bi))}`
  const opts: RequestInit = { method, headers: H }
  if (method === "POST") opts.body = JSON.stringify(bi)
  const r = await fetch(url, opts)
  const d = await r.json() as Array<{ error?: unknown; result?: { data?: { json?: T } } }>
  if (d[0]?.error) {
    const err = (d[0].error as { json?: { message?: string } })?.json?.message
    if (err) console.log(`  ${endpoint}: ${err.slice(0, 150)}`)
    return null
  }
  console.log(`  ✅ ${endpoint} SUCCESS`)
  return d[0]?.result?.data?.json ?? null
}

async function main() {
  console.log("🕵 探测添加课程包 API v2\n")

  const testPackId = "lccr3qryh0yzebh0d2ogxu2r" // charlotte's web

  // 更多探测
  const probes: Array<[string, string, Record<string, unknown>]> = [
    // userCoursePacks 可能操作
    ["POST", "userCoursePacks.addFree", { coursePackId: testPackId }],
    ["POST", "userCoursePacks.claim", { coursePackId: testPackId }],
    ["POST", "userCoursePacks.subscribe", { coursePackId: testPackId }],
    // mall 相关
    ["POST", "mall.addCoursePackToUser", { coursePackId: testPackId }],
    ["POST", "mall.claimPack", { coursePackId: testPackId }],
    ["POST", "mall.freeEnroll", { coursePackId: testPackId }],
    // 其他
    ["POST", "coursePacks.join", { coursePackId: testPackId }],
    ["POST", "coursePacks.freeJoin", { coursePackId: testPackId }],
    // 浏览一下 mall 首页看看有没有自动添加
    ["GET", "mall.getMallHomepage", null],
  ]

  for (const [method, ep, inp] of probes) {
    process.stdout.write(`  ${method} ${ep}... `)
    await jf(ep, inp, method as "GET" | "POST")
  }

  // 最终的包列表
  console.log("\n📋 我的课程包:")
  const myPacks = await jf<Array<{ coursePackId: string; title: string }>>("userCoursePacks.list", {})
  myPacks?.forEach(p => console.log(`  - ${p.title}`))
}

main()
