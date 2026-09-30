/**
 * 把封面图片分配成「一门课一张专属图」，并写入 courses.cover_url。
 *
 * 用法：
 *   npx tsx scripts/assign-course-covers.ts            # dry-run：只打印分配结果，不写库
 *   npx tsx scripts/assign-course-covers.ts --apply    # 备份后写库
 *
 * ── 分配规则 ────────────────────────────────────────────────────────────────
 *
 * 1. **教材同步（school_sync）**：按 `scripts/gen-textbook-covers.ts` 产出的计划来 ——
 *    前 36 门复用已有的槽位图，其余 158 门用逐课新生成的 `<课程id>.webp`。
 * 2. **其他分类**：每个槽位现有的 `<slot>__v<n>.webp` 按使用量高低 1:1 分给该槽位的课程。
 * 3. 分不到图的课**不写 cover_url** —— 它们会显示按课程着色的分类色卡（这是预期状态）。
 *
 * ── 几条硬约束 ──────────────────────────────────────────────────────────────
 *
 * - **同一张图只能分给一门课**：需求方明确要求「任何两门课都不共用同一张图」，
 *   所以分配时必须去重，而不能简单地把槽位图复制给整个槽位。
 * - **只写目标文件真实存在的路径**：逐课图的文件名是课程 id，写错一个字符就是 404，
 *   而 404 的表现只是「那张卡片退回色卡」，不报错、肉眼也看不出来。
 * - **写库前必须 mysqldump 备份**：生产库就是唯一的库，没有 staging。
 */

import fs from "node:fs"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { config as loadEnv } from "dotenv"
import { createConnection } from "mysql2/promise"

const ROOT = path.join(__dirname, "..")
loadEnv({ path: path.join(ROOT, ".env.local") })

const WEB_DIR = path.join(ROOT, "public", "images", "courses")
const PLAN_FILE = path.join(ROOT, ".covers-build", "textbook-plan.json")
const BACKUP_DIR = path.join(ROOT, "db-backup")

interface PlanItem {
  courseId: string
  title: string
  slot: string
  kind: "reuse" | "new"
  file: string
}

interface Assignment {
  courseId: string
  title: string
  src: string
  source: "textbook-reuse" | "textbook-new" | "slot-reuse"
}

function databaseUrl(): string {
  const m = fs.readFileSync(path.join(ROOT, ".env.local"), "utf8").match(/^DATABASE_URL=(.+)$/m)
  if (!m) throw new Error("在 .env.local 里找不到 DATABASE_URL")
  return m[1].trim()
}

async function main() {
  const apply = process.argv.includes("--apply")
  if (!fs.existsSync(PLAN_FILE)) {
    throw new Error(`找不到教材同步计划 ${PLAN_FILE}，请先跑 scripts/gen-textbook-covers.ts --step=plan`)
  }
  const plan: PlanItem[] = JSON.parse(fs.readFileSync(PLAN_FILE, "utf8"))

  const conn = await createConnection(databaseUrl())
  const [rows] = await conn.execute(
    `SELECT id, title, category_key, sub_category_key, usage_count
       FROM courses WHERE is_published = 1
      ORDER BY usage_count DESC`,
  )
  const courses = rows as {
    id: string
    title: string
    category_key: string | null
    sub_category_key: string | null
    usage_count: number
  }[]

  const byId = new Map(courses.map((c) => [c.id, c]))
  const assignments: Assignment[] = []
  const usedFiles = new Set<string>()
  const problems: string[] = []

  // ── 1) 教材同步：按计划 ──────────────────────────────────────────────────
  for (const item of plan) {
    const course = byId.get(item.courseId)
    if (!course) {
      problems.push(`计划里的课程不在库中（可能已下架）：${item.title}`)
      continue
    }
    const src = `/images/courses/${item.file}`
    if (!fs.existsSync(path.join(WEB_DIR, item.file))) {
      problems.push(`目标文件不存在，跳过：${item.title} → ${item.file}`)
      continue
    }
    if (usedFiles.has(item.file)) {
      problems.push(`同一张图被计划分配给多门课：${item.file}`)
      continue
    }
    usedFiles.add(item.file)
    assignments.push({
      courseId: item.courseId,
      title: item.title,
      src,
      source: item.kind === "reuse" ? "textbook-reuse" : "textbook-new",
    })
  }

  // ── 2) 其他分类：每个槽位现有的图 1:1 分给该槽位的课 ─────────────────────
  const slots = new Map<string, typeof courses>()
  for (const c of courses) {
    if (c.category_key === "school_sync") continue // 已在第 1 步处理
    const slot = `${c.category_key ?? "none"}__${c.sub_category_key ?? "general"}`
    if (!slots.has(slot)) slots.set(slot, [])
    slots.get(slot)!.push(c)
  }
  for (const [slot, list] of slots) {
    const stock = fs
      .readdirSync(WEB_DIR)
      .filter((f) => f.startsWith(`${slot}__v`) && f.endsWith(".webp"))
      .sort()
    for (let i = 0; i < Math.min(stock.length, list.length); i++) {
      if (usedFiles.has(stock[i])) {
        problems.push(`同一张图被两个槽位共用：${stock[i]}`)
        continue
      }
      usedFiles.add(stock[i])
      assignments.push({
        courseId: list[i].id,
        title: list[i].title,
        src: `/images/courses/${stock[i]}`,
        source: "slot-reuse",
      })
    }
  }

  const withImage = new Set(assignments.map((a) => a.courseId))
  const bySource = (k: Assignment["source"]) => assignments.filter((a) => a.source === k).length

  console.log(`在架课程            : ${courses.length}`)
  console.log(`本次将写入 cover_url : ${assignments.length} 门`)
  console.log(`  教材同步·复用现有图 : ${bySource("textbook-reuse")}`)
  console.log(`  教材同步·逐课新生成 : ${bySource("textbook-new")}`)
  console.log(`  其他分类·复用现有图 : ${bySource("slot-reuse")}`)
  console.log(`其余显示分类色卡     : ${courses.length - withImage.size} 门`)
  console.log(`引用的图片文件去重后 : ${usedFiles.size} 个`)

  if (problems.length) {
    console.log(`\n⚠ 跳过 ${problems.length} 条：`)
    for (const p of problems.slice(0, 12)) console.log(`  - ${p}`)
  }

  if (!apply) {
    console.log(`\n（dry-run）抽样看前 8 条分配：`)
    for (const a of assignments.slice(0, 8)) {
      console.log(`  ${a.title.slice(0, 22).padEnd(24)} → ${a.src}`)
    }
    console.log(`\n确认无误后加 --apply 写库（会先 mysqldump 备份）`)
    await conn.end()
    return
  }

  // ── 备份 ────────────────────────────────────────────────────────────────
  fs.mkdirSync(BACKUP_DIR, { recursive: true })
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 15)
  const backup = path.join(BACKUP_DIR, `courses-before-cover-assign-${stamp}.sql`)
  const url = new URL(databaseUrl())
  console.log(`\n[backup] 正在备份 courses 表 → ${path.relative(ROOT, backup)}`)
  const dump = execFileSync(
    "mysqldump",
    [
      "-h", url.hostname,
      "-P", url.port || "3306",
      "-u", decodeURIComponent(url.username),
      `-p${decodeURIComponent(url.password)}`,
      "--single-transaction",
      "--no-tablespaces",
      "--skip-add-locks",
      url.pathname.replace(/^\//, ""),
      "courses",
    ],
    { stdio: ["ignore", "pipe", "ignore"], maxBuffer: 512 * 1024 * 1024 },
  )
  fs.writeFileSync(backup, dump)
  const size = dump.length
  // 备份必须包含全部行 —— 只按体积判断不够，行数对不上就是残缺备份
  const backedUpRows = (dump.toString("utf8").match(/\),\(/g) ?? []).length + 1
  console.log(`[backup] 完成 ${(size / 1024).toFixed(0)}KB，备份内数据行数约 ${backedUpRows}`)
  if (size < 10_000) throw new Error("备份文件过小，疑似失败，已中止写库")
  if (backedUpRows < courses.length) {
    throw new Error(`备份行数 ${backedUpRows} 少于在架课程数 ${courses.length}，疑似残缺，已中止写库`)
  }

  // ── 写库（事务） ────────────────────────────────────────────────────────
  console.log(`\n[apply] 写入 ${assignments.length} 行 cover_url…`)
  await conn.beginTransaction()
  try {
    for (const a of assignments) {
      await conn.execute("UPDATE courses SET cover_url = ? WHERE id = ?", [a.src, a.courseId])
    }
    await conn.commit()
    console.log("[apply] 提交完成")
  } catch (e) {
    await conn.rollback()
    throw e
  }

  const [[check]]: any = await conn.execute(
    `SELECT COUNT(*) total,
            SUM(cover_url IS NOT NULL AND cover_url <> '') with_cover
       FROM courses WHERE is_published = 1`,
  )
  console.log(`[verify] 在架 ${check.total} 门，其中 ${check.with_cover} 门已有 cover_url`)
  await conn.end()
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack : e)
  process.exit(1)
})
