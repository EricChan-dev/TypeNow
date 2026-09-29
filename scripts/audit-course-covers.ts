/**
 * 封面数据验收：**用生产库的 774 门真实课程**逐门断言封面解析结果，并统计变体分布。
 *
 * 用法：
 *   npx tsx scripts/audit-course-covers.ts
 *
 * ── 与单测的分工 ────────────────────────────────────────────────────────────
 *
 * `src/__tests__/course-cover.test.ts` 用构造数据验证 `resolveCourseCover` 的**逻辑**；
 * `src/__tests__/course-cover-files.test.ts` 验证 176 个文件**存在**；
 * 这个脚本验证**真实数据**——「没有任何一门课落到渐变兜底」。
 * 三者不能互相替代：文件都在、逻辑也对，仍可能因为某个槽位没进清单而漏掉一批课。
 *
 * ── 为什么直连 mysql2 而不是复用 src/lib/db ──────────────────────────────────
 *
 * ESM 的 import 会被提升到 `loadEnv()` 之前执行，所以「先 dotenv 再 import db」
 * 是无效的 —— 那个模块在求值时 process.env.DATABASE_URL 还是空的。
 * 本仓库既有脚本（audit-course-data.ts / backfill-textbook-version.ts）统一走
 * 「手工读 .env.local + mysql2 直连」，这里沿用同一约定。
 *
 * 但**解析逻辑必须是真件而不是复制品**：`resolveCourseCover` 与 `themeSlug`
 * 是纯函数、不依赖环境变量，直接 import（tsx 能解析 `@/` 别名）。
 * 若这里另写一份解析逻辑，就等于用复制品验证原件，毫无意义。
 */

import fs from "node:fs"
import path from "node:path"
import { createConnection } from "mysql2/promise"

import { resolveCourseCover, themeVariantIndex } from "@/lib/course-cover"
import { COVER_VARIANTS_PER_THEME, themeSlug } from "@/lib/course-cover-themes"

const ROOT = path.join(__dirname, "..")

/** 从 .env.local 手工取 DATABASE_URL（见文件顶部说明：不能靠 import 时机读 process.env） */
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
  let explicit = 0
  let fromTheme = 0
  const graded: string[] = []
  const missingFiles: string[] = []
  const variantHistogram = new Map<number, number>()

  for (const c of list) {
    const cover = resolveCourseCover({
      id: c.id,
      coverUrl: c.cover_url,
      categoryKey: c.category_key,
      subCategoryKey: c.sub_category_key,
    })

    if (cover.kind === "gradient") {
      graded.push(
        `${c.title}  [${themeSlug(c.category_key, c.sub_category_key)}]`,
      )
      continue
    }
    if (c.cover_url?.trim()) {
      explicit++
      continue
    }

    fromTheme++
    const file = path.join(ROOT, "public", cover.src)
    if (!fs.existsSync(file)) missingFiles.push(`${c.title} → ${cover.src}`)
    const v = themeVariantIndex(c.id)
    variantHistogram.set(v, (variantHistogram.get(v) ?? 0) + 1)
  }

  const total = list.length
  console.log(`在架课程            : ${total}`)
  console.log(`cover_url 覆盖      : ${explicit}`)
  console.log(`走主题变体表        : ${fromTheme}`)
  console.log(`落到渐变兜底        : ${graded.length}   ← 必须为 0`)
  console.log(
    `变体分布 v1..v${COVER_VARIANTS_PER_THEME}  : ` +
      Array.from({ length: COVER_VARIANTS_PER_THEME }, (_, i) => variantHistogram.get(i) ?? 0).join(
        " / ",
      ),
  )

  let failed = false

  if (missingFiles.length) {
    console.error(`\n指向不存在的图片 ${missingFiles.length} 条：`)
    for (const m of missingFiles.slice(0, 10)) console.error(`  - ${m}`)
    failed = true
  }

  if (graded.length) {
    console.error(
      `\n有 ${graded.length} 门课落到渐变兜底 —— 说明有槽位没被覆盖，或清单缺项：`,
    )
    for (const g of graded.slice(0, 10)) console.error(`  - ${g}`)
    failed = true
  }

  if (failed) process.exit(1)

  console.log("\n✓ 全部在架课程都能解析到主题图")
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
