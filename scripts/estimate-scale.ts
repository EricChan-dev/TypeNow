#!/usr/bin/env tsx
/** 估算全量爬取规模 */
import { config } from "dotenv"
import { join, dirname } from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
config({ path: join(dirname(__filename), "..", ".env.local") })

const C = process.env.JULEBU_COOKIE
if (!C) { process.exit(1) }

const H: Record<string, string> = { "accept": "*/*", "content-type": "application/json", "cookie": C, "Referer": "https://julebu.co/" }

async function main() {
  const r = await fetch(`https://api.julebu.co/trpc/mall.search?batch=1&input=${encodeURIComponent(JSON.stringify({ "0": { json: { sortBy: "created_at", page: 1, pageSize: 2000 } } }))}`, { headers: H })
  const d = await r.json()
  const packs: Array<{ courseCount?: number }> = d[0]?.result?.data?.json?.coursePacks ?? []

  const totalCourses = packs.reduce((s, p) => s + (p.courseCount || 0), 0)
  const estSentences = totalCourses * 15
  const estMinutes = Math.round(totalCourses * 15 / 60)
  const estHours = Math.round(estMinutes / 6) / 10

  console.log(`课程包:    ${packs.length}`)
  console.log(`课程总数:  ${totalCourses.toLocaleString()}`)
  console.log(`估算句子:  ${estSentences.toLocaleString()} (约 15句/课)`)
  console.log(`估算时间:  ${estMinutes} 分钟 ≈ ${estHours} 小时 (约 15s/课)`)
}

main()
