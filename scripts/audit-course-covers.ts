/**
 * 封面数据验收：用生产库的真实课程逐门断言封面解析结果。
 *
 * 用法：
 *   npx tsx scripts/audit-course-covers.ts
 *
 * ── 2026-09-30 起断言口径变了 ──────────────────────────────────────────────
 *
 * 旧口径是「没有任何一门课落到渐变兜底」。当时封面是「同槽位共用主题图」，
 * 落到兜底说明映射表缺项。
 *
 * 现在改成**专属图 → 分类色卡**两层，色卡是正常状态，不再算失败。
 * 新的核心断言变成需求方明确提出的那条：
 *
 *   **没有任何两门课共用同一张图。**
 *
 * 以及一条工程安全断言：`cover_url` 指向的本地文件必须真实存在 ——
 * 逐课图的文件名是课程 id，写错一个字符就是一张 404，而 404 的表现只是
 * 「那张卡片退回色卡」，不会报错，肉眼也发现不了。
 *
 * ── 为什么直连 mysql2 而不是复用 src/lib/db ──────────────────────────────────
 *
 * ESM 的 import 会被提升到 `loadEnv()` 之前执行，所以「先 dotenv 再 import db」
 * 是无效的。本仓库既有脚本统一走「手工读 .env.local + mysql2 直连」。
 * 但解析与配色逻辑必须是**真件**：`resolveCourseCover` 等是纯函数、
 * 不依赖环境变量，直接 import（tsx 能解析 `@/` 别名）。
 */

import fs from "node:fs"
import path from "node:path"
import { createConnection } from "mysql2/promise"

import { resolveCourseCover } from "@/lib/course-cover"

const ROOT = path.join(__dirname, "..")

function databaseUrl(): string {
  const envPath = path.join(ROOT, ".env.local")
  const text = fs.readFileSync(envPath, "utf8")
  const m = text.match(/^DATABASE_URL=(.+)$/m)
  if (!m) throw new Error(`在 ${envPath} 中找不到 DATABASE_URL`)
  return m[1].trim()
}

interface Row {
  id: string
  title: string
  cover_url: string | null
  category_key: string | null
  sub_category_key: string | null
}

async function main() {
  const conn = await createConnection(databaseUrl())
  const [rows] = await conn.execute(
    `SELECT id, title, cover_url, category_key, sub_category_key
       FROM courses WHERE is_published = 1`,
  )
  await conn.end()

  const list = rows as Row[]
  const srcToCourses = new Map<string, string[]>()
  const gradients = new Map<string, string[]>()
  const missingFiles: string[] = []
  let withImage = 0
  let colorCard = 0

  for (const c of list) {
    const cover = resolveCourseCover({
      id: c.id,
      coverUrl: c.cover_url,
      categoryKey: c.category_key,
      subCategoryKey: c.sub_category_key,
    })

    // 色卡必须永远有渐变（否则就是空白封面）
    if (!cover.gradient.startsWith("linear-gradient")) {
      console.error(`✗ 色卡渐变异常：${c.title} → ${cover.gradient}`)
      process.exitCode = 1
    }

    if (cover.kind === "image") {
      withImage++
      const arr = srcToCourses.get(cover.src) ?? []
      arr.push(c.title)
      srcToCourses.set(cover.src, arr)

      // 本地路径必须真实存在（外链与 dataURL 不检查）
      if (cover.src.startsWith("/")) {
        const file = path.join(ROOT, "public", cover.src)
        if (!fs.existsSync(file)) missingFiles.push(`${c.title} → ${cover.src}`)
      }
    } else {
      colorCard++
      const key = cover.gradient
      const arr = gradients.get(key) ?? []
      arr.push(c.title)
      gradients.set(key, arr)
    }
  }

  const duplicated = [...srcToCourses.entries()].filter(([, courses]) => courses.length > 1)
  const dupGradients = [...gradients.entries()].filter(([, courses]) => courses.length > 1)
  const maxGradReuse = Math.max(0, ...dupGradients.map(([, c]) => c.length))

  console.log(`在架课程            : ${list.length}`)
  console.log(`专属图              : ${withImage} 门（${((withImage / list.length) * 100).toFixed(1)}%）`)
  console.log(`分类色卡            : ${colorCard} 门（${((colorCard / list.length) * 100).toFixed(1)}%）`)
  console.log(`引用的图片文件      : ${srcToCourses.size} 个`)
  console.log(`色卡配色种类        : ${gradients.size} 种`)
  if (dupGradients.length) {
    console.log(`  （有 ${dupGradients.length} 种配色被多门课共用，最多 ${maxGradReuse} 门）`)
  }

  if (missingFiles.length) {
    console.error(`\n✗ cover_url 指向的文件不存在 ${missingFiles.length} 条：`)
    for (const m of missingFiles.slice(0, 12)) console.error(`  - ${m}`)
    process.exitCode = 1
  }

  if (duplicated.length) {
    console.error(`\n✗ 有 ${duplicated.length} 张图被多门课共用（需求方要求「任何两门课都不共用同一张图」）：`)
    for (const [src, courses] of duplicated.slice(0, 12)) {
      console.error(`  ${src}  ← ${courses.length} 门：${courses.slice(0, 3).join(" / ")}`)
    }
    process.exitCode = 1
  }

  if (!process.exitCode) {
    console.log("\n✓ 所有 cover_url 指向的文件都存在")
    console.log("✓ 没有任何两门课共用同一张图")
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
