/**
 * 按 ID 列表软删除课程（默认只读，--apply 才写入）
 *
 * 走 app 自己的 softDeleteCourse()，不手写 SQL —— 这样级联范围、deleted_batch
 * 的 UUID、以及仪表盘缓存失效都和后台「删除」按钮完全一致，
 * 后台回收站能按同一批次精确还原。
 *
 * 用法：
 *   npx tsx scripts/soft-delete-courses.ts --ids-file /tmp/del_ids.json            # 只读预检
 *   npx tsx scripts/soft-delete-courses.ts --ids-file /tmp/del_ids.json --apply    # 执行
 */

import fs from "node:fs"
import path from "node:path"

const APPLY = process.argv.includes("--apply")
const idsFileIdx = process.argv.indexOf("--ids-file")
if (idsFileIdx < 0 || !process.argv[idsFileIdx + 1]) {
  throw new Error("需要 --ids-file <path>")
}
const idsFile = process.argv[idsFileIdx + 1]
const ids: string[] = JSON.parse(fs.readFileSync(idsFile, "utf8"))
if (!Array.isArray(ids) || ids.length === 0) throw new Error("ID 列表为空")

// 先手动加载 .env.local，再动态 import @/lib/db ——
// lib/db 在模块顶层就读 process.env.DATABASE_URL，顺序不能反。
function loadEnvLocal(): void {
  const p = path.join(process.cwd(), ".env.local")
  if (!fs.existsSync(p)) return
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
    if (!m) continue
    if (process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").replace(/\r$/, "")
    }
  }
}
loadEnvLocal()

const t0 = Date.now()
const P = (s: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${s}`)

async function main() {
  const { db } = await import("@/lib/db")
  const { courses, lessons, sentences } = await import("@/lib/db/schema")
  const { softDeleteCourse } = await import("@/lib/soft-delete")
  const { and, eq, inArray, isNull, sql } = await import("drizzle-orm")

  if (!db) throw new Error("DATABASE_URL 未配置")
  const database = db

  // 预检：逐门打印标题/分类/影响面
  P(`预检 ${ids.length} 门课程 …`)
  const found = await database
    .select({
      id: courses.id,
      title: courses.title,
      categoryKey: courses.categoryKey,
      isPublished: courses.isPublished,
      deletedAt: courses.deletedAt,
    })
    .from(courses)
    .where(inArray(courses.id, ids))

  const byId = new Map(found.map((c) => [c.id, c]))
  const missing = ids.filter((id) => !byId.has(id))
  const alreadyDeleted = found.filter((c) => c.deletedAt !== null)

  let totalLessons = 0
  let totalSentences = 0
  const plan: { id: string; title: string; lessons: number; sentences: number }[] = []

  for (const id of ids) {
    const c = byId.get(id)
    if (!c) continue
    const ls = await database
      .select({ id: lessons.id })
      .from(lessons)
      .where(and(eq(lessons.courseId, id), isNull(lessons.deletedAt)))
    const lessonIds = ls.map((l) => l.id)
    let sc = 0
    if (lessonIds.length > 0) {
      const [row] = await database
        .select({ n: sql<number>`COUNT(*)` })
        .from(sentences)
        .where(and(inArray(sentences.lessonId, lessonIds), isNull(sentences.deletedAt)))
      sc = Number(row?.n ?? 0)
    }
    totalLessons += lessonIds.length
    totalSentences += sc
    plan.push({ id, title: c.title, lessons: lessonIds.length, sentences: sc })
  }

  console.log("")
  console.log("  标题".padEnd(30) + "分类".padEnd(16) + "课时  句子   状态")
  for (const p of plan) {
    const c = byId.get(p.id)!
    console.log(
      "  " + (c.title ?? "(无标题)").slice(0, 26).padEnd(28) +
        (c.categoryKey ?? "(空)").padEnd(16) +
        String(p.lessons).padStart(4) + String(p.sentences).padStart(6) +
        "   " + (c.deletedAt ? "已删" : c.isPublished ? "已发布" : "未发布"),
    )
  }
  console.log("")
  P(`合计：${plan.length} 门 / ${totalLessons} 课时 / ${totalSentences} 句子`)
  if (missing.length) P(`⚠ 不存在：${missing.length} 个 id → ${missing.join(", ")}`)
  if (alreadyDeleted.length) P(`⚠ 已是删除态：${alreadyDeleted.map((c) => c.title).join(", ")}`)

  if (!APPLY) {
    console.log("")
    P("只读模式，未写入。加 --apply 执行。")
    return
  }

  console.log("")
  P("开始软删除 …")
  const results: { id: string; title: string; batch: string | null; lessons: number; sentences: number }[] = []
  for (const p of plan) {
    const impact = await softDeleteCourse(p.id)
    const [row] = await database
      .select({ deletedBatch: courses.deletedBatch, deletedAt: courses.deletedAt })
      .from(courses)
      .where(eq(courses.id, p.id))
      .limit(1)
    results.push({
      id: p.id,
      title: p.title,
      batch: row?.deletedBatch ?? null,
      lessons: impact?.lessons ?? 0,
      sentences: impact?.sentences ?? 0,
    })
    P(`  ✔ ${p.title}  批次 ${row?.deletedBatch ?? "-"}`)
  }

  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14)
  const logFile = `db-backup/soft-delete-batches-${stamp}.json`
  fs.writeFileSync(logFile, JSON.stringify(results, null, 2))
  console.log("")
  P(`完成 ${results.length} 门，批次清单写入 ${logFile}`)
  P("还原命令示例（逐门）：PATCH /api/admin/courses/<id>，或调用 restoreCourse(id)")
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error("失败:", e)
    process.exit(1)
  },
)
