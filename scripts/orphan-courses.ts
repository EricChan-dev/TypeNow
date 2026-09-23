/**
 * 孤儿课时处置：抢救映射方案 + 安全清理
 *
 * 背景（2026-09 排查结论）：
 *   1,712 个课时的 course_id 指向不存在的课程，只对应 34 个缺失课程 id。
 *   这些课时全部创建于 2026-06-12 09:09:04–09:13:24 一个 4 分钟窗口内，
 *   而 courses 表里躺着 26 个「0 课时 + 未发布」的同名空壳。
 *   → 一次重导入建了新的课程行、删了老的课程行，但课时没跟着迁移。
 *   全库没有任何外键约束（information_schema 里 references 为空），
 *   所以删除既不会级联也不会报错，课时就这样永久悬空。
 *
 * 三类（按内容级比对：中英文完全相同才算同款）：
 *   A 完全冗余   现存已发布课程里 100% 有同款 → 删了不丢内容
 *   C 含独有内容 是唯一副本（含整本新概念第三册）→ 抢救，不删
 *   D 零句子     纯空壳 → 删了不丢内容
 *
 * 用法：
 *   npx tsx scripts/orphan-courses.ts              # 只读：分类 + 抢救映射方案
 *   npx tsx scripts/orphan-courses.ts --apply=ad   # 清理 A + D 类（C 类不动）
 *   npx tsx scripts/orphan-courses.ts --apply=d    # 只清 D 类空壳
 *
 * 注意：本脚本永远不删除 C 类。要删 C 类必须改代码，属于有意为之。
 */

import { createConnection, type Connection } from "mysql2/promise"
import fs from "node:fs"
import path from "node:path"
import zlib from "node:zlib"

const applyArg = process.argv.find((a) => a.startsWith("--apply"))
const APPLY = applyArg !== undefined
const APPLY_WHICH = applyArg?.split("=")[1] ?? (APPLY ? "ad" : "")
const EXPORT_DIR = "content-deleted"

const ORPH = `NOT EXISTS (SELECT 1 FROM courses c WHERE c.id = l.course_id)`

function dbUrl(): string {
  const m = fs.readFileSync(".env.local", "utf8").match(/^DATABASE_URL=(.*)$/m)
  if (!m) throw new Error(".env.local 里找不到 DATABASE_URL")
  return m[1].trim()
}

const t0 = Date.now()
const P = (s: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] ${s}`)
const N = (n: unknown) => Number(n).toLocaleString("en-US")

async function rows<T = Record<string, unknown>>(c: Connection, sql: string, p?: unknown[]): Promise<T[]> {
  const [r] = await c.query(sql, p)
  return r as T[]
}

function exportRows(name: string, data: unknown[]): string {
  if (!data.length) return "(空)"
  fs.mkdirSync(EXPORT_DIR, { recursive: true })
  const file = path.join(EXPORT_DIR, `${name}.jsonl.gz`)
  fs.writeFileSync(file, zlib.gzipSync(data.map((r) => JSON.stringify(r)).join("\n")))
  return `${file} (${(fs.statSync(file).size / 1024 / 1024).toFixed(1)} MB, ${N(data.length)} 行)`
}

type OrphanCourse = {
  course_id: string
  n_lessons: number
  n_sent: number
  n_distinct: number
  n_empty_lessons: number
  novel: number
}

async function main() {
  const conn = await createConnection({ uri: dbUrl(), connectTimeout: 30000 })
  console.log(APPLY ? `模式：APPLY（清理 ${APPLY_WHICH.toUpperCase()} 类）` : "模式：只读（分类 + 抢救映射方案）")

  // 全部 34 个孤儿课程
  const all = await rows<OrphanCourse>(conn, `
    SELECT l.course_id, COUNT(*) n_lessons,
      (SELECT COUNT(*) FROM sentences s WHERE s.lesson_id IN (SELECT id FROM lessons l2 WHERE l2.course_id = l.course_id)) n_sent,
      SUM(NOT EXISTS (SELECT 1 FROM sentences s WHERE s.lesson_id = l.id)) n_empty_lessons
    FROM lessons l WHERE ${ORPH} GROUP BY l.course_id`)

  // 内容级比对：孤儿句 vs 现存已发布课程句
  //
  // 必须先去重到「不同的（中英文）组合」再比。孤儿课时内部本身就有重复句
  // （见 repair-duplicates.ts），直接 COUNT(*) 数的是配对行数，会出现
  // 「重合 1,192 / 总共 385 句」这种超过总数的荒谬结果。
  P("内容级比对（去重到不同中英文组合后，判断是否已有同款）")
  await conn.query(`DROP TEMPORARY TABLE IF EXISTS orph_sent`)
  await conn.query(`CREATE TEMPORARY TABLE orph_sent AS
    SELECT s.chinese, s.english, l.course_id FROM sentences s JOIN lessons l ON l.id = s.lesson_id WHERE ${ORPH}`)
  await conn.query(`DROP TEMPORARY TABLE IF EXISTS orph_dist`)
  await conn.query(`CREATE TEMPORARY TABLE orph_dist AS
    SELECT DISTINCT course_id, chinese, english FROM orph_sent`)
  await conn.query(`DROP TEMPORARY TABLE IF EXISTS live_sent`)
  await conn.query(`CREATE TEMPORARY TABLE live_sent AS
    SELECT DISTINCT s.chinese, s.english FROM sentences s JOIN lessons l ON l.id = s.lesson_id
    JOIN courses c ON c.id = l.course_id WHERE c.is_published = 1`)
  const novel = new Map<string, number>(
    (await rows<{ course_id: string; novel: number }>(conn, `
      SELECT o.course_id, SUM(lv.chinese IS NULL) novel
      FROM orph_dist o LEFT JOIN live_sent lv ON lv.chinese = o.chinese AND lv.english = o.english
      GROUP BY o.course_id`)).map((r) => [r.course_id, Number(r.novel)]))
  const distinctN = new Map<string, number>(
    (await rows<{ course_id: string; n: number }>(conn, `
      SELECT course_id, COUNT(*) n FROM orph_dist GROUP BY course_id`)).map((r) => [r.course_id, Number(r.n)]))

  for (const c of all) {
    c.n_distinct = distinctN.get(c.course_id) ?? 0
    c.novel = c.n_distinct > 0 ? (novel.get(c.course_id) ?? c.n_distinct) : 0
  }
  const A = all.filter((c) => c.n_distinct > 0 && c.novel === 0)
  const C = all.filter((c) => c.n_distinct > 0 && c.novel > 0)
  const D = all.filter((c) => c.n_distinct === 0)
  const sum = (a: OrphanCourse[], k: keyof OrphanCourse) => a.reduce((s, x) => s + Number(x[k]), 0)

  console.log(`\n孤儿课程 ${all.length} 个 · 课时 ${N(sum(all, "n_lessons"))} · 句子行 ${N(sum(all, "n_sent"))} · 去重句 ${N(sum(all, "n_distinct"))}`)
  console.log(`  A 完全冗余   ${A.length} 课程 · ${N(sum(A, "n_lessons"))} 课时 · 去重 ${N(sum(A, "n_distinct"))} 句（现存课程里 100% 有同款）`)
  console.log(`  C 含独有内容 ${C.length} 课程 · ${N(sum(C, "n_lessons"))} 课时 · 去重 ${N(sum(C, "n_distinct"))} 句（独有 ${N(sum(C, "novel"))}）`)
  console.log(`  D 零句子     ${D.length} 课程 · ${N(sum(D, "n_lessons"))} 课时 · 0 句`)
  console.log(`  校验 A+C+D 课时 = ${N(sum(A, "n_lessons") + sum(C, "n_lessons") + sum(D, "n_lessons"))} （应等于 ${N(sum(all, "n_lessons"))}）`)
  console.log(`  校验 A+C+D 课程 = ${A.length + C.length + D.length} （应等于 ${all.length}）`)

  // ── 抢救映射方案 ────────────────────────────────────────────────────────
  P("抢救映射方案：为每门 C 类孤儿课程找最合适的课程行")
  // ① 内容重合最多的现存课程（说明这门课在库里已有对应课程）
  await conn.query(`DROP TEMPORARY TABLE IF EXISTS all_sent`)
  await conn.query(`CREATE TEMPORARY TABLE all_sent AS
    SELECT c.id course_id, c.title, c.is_published, s.chinese, s.english
    FROM sentences s JOIN lessons l ON l.id = s.lesson_id JOIN courses c ON c.id = l.course_id`)
  const overlap = new Map<string, { title: string; pub: number; shared: number }>()
  for (const r of await rows<{ orphan: string; title: string; is_published: number; shared: number }>(conn, `
    SELECT o.course_id orphan, MIN(a.title) title, MIN(a.is_published) is_published,
           COUNT(DISTINCT o.chinese, o.english) shared
    FROM orph_dist o JOIN all_sent a ON a.chinese = o.chinese AND a.english = o.english
    GROUP BY o.course_id, a.course_id`)) {
    const prev = overlap.get(r.orphan)
    if (!prev || Number(r.shared) > prev.shared) {
      overlap.set(r.orphan, { title: r.title, pub: Number(r.is_published), shared: Number(r.shared) })
    }
  }
  // 课时标题重合最高的现存课程（用于判断这门课是不是「同系列的已发布版本」）
  const titleOv = new Map<string, { title: string; hit: number; total: number; pub: number }>()
  for (const r of await rows<{ orphan: string; title: string; hit: number; total: number; is_published: number }>(conn, `
    SELECT o.course_id orphan, c.title, c.is_published, COUNT(*) hit,
           (SELECT COUNT(*) FROM lessons l3 WHERE l3.course_id = c.id) total
    FROM lessons o JOIN lessons l2 ON l2.title = o.title AND l2.course_id <> o.course_id
    JOIN courses c ON c.id = l2.course_id
    WHERE ${ORPH.replace(/l\./g, "o.")}
    GROUP BY o.course_id, c.id, c.title, c.is_published`)) {
    const prev = titleOv.get(r.orphan)
    if (!prev || Number(r.hit) > prev.hit) {
      titleOv.set(r.orphan, { title: r.title, hit: Number(r.hit), total: Number(r.total), pub: Number(r.is_published) })
    }
  }
  // ② 空壳课程（0 课时）按标题相似度候选
  const shells = await rows<{ id: string; title: string }>(conn, `
    SELECT id, title FROM courses c WHERE NOT EXISTS (SELECT 1 FROM lessons l WHERE l.course_id = c.id)`)

  const map: Record<string, unknown>[] = []
  for (const c of C.sort((a, b) => b.novel - a.novel)) {
    const ov = overlap.get(c.course_id)
    const to = titleOv.get(c.course_id)
    const titles = await rows<{ title: string }>(conn, `SELECT title FROM lessons WHERE course_id = ? ORDER BY sort_order LIMIT 5`, [c.course_id])
    map.push({
      孤儿课程: c.course_id.slice(0, 8),
      课时: c.n_lessons,
      去重句: c.n_distinct,
      独有: c.novel,
      课时标题样例: titles.map((t) => String(t.title).slice(0, 22)).join(" / "),
      内容最重合的现存课程: ov ? `${ov.title}（${N(ov.shared)}/${N(c.n_distinct)}${ov.pub ? "" : " 未发布"}）` : "无",
      课时标题重合: to ? `${to.title}（${to.hit}/${to.total}${to.pub ? "" : " 未发布"}）` : "无同标题课程",
    })
  }
  console.table(map)
  console.log(`\n=== courses 表里的空壳课程（0 课时，可在抢救时作为改挂目标）共 ${shells.length} 个 ===`)
  console.log(shells.map((s) => s.title).join("\n"))

  if (!APPLY) {
    console.log("\n以上为只读方案。C 类不做任何改动；A/D 类清理需显式 --apply=ad。")
    await conn.end()
    return
  }

  // ── 清理 A / D ─────────────────────────────────────────────────────────
  const targets = [
    ...(/a/.test(APPLY_WHICH) ? A : []),
    ...(/d/.test(APPLY_WHICH) ? D : []),
  ]
  if (!targets.length) {
    console.log("没有要清理的目标。")
    await conn.end()
    return
  }
  const ids = targets.map((t) => t.course_id)
  const ph = ids.map(() => "?").join(",")
  P(`清理 ${targets.length} 个课程（${APPLY_WHICH.toUpperCase()} 类）`)

  // 兜底：此刻再确认这些课程确实还不存在、且确实没有独有内容
  const stillMissing = (await rows<{ n: number }>(conn, `SELECT COUNT(*) n FROM courses WHERE id IN (${ph})`, ids))[0]
  if (Number(stillMissing.n) > 0) throw new Error(`有 ${stillMissing.n} 个课程 id 现在已存在，中止`)
  for (const t of targets.filter((x) => x.n_sent > 0)) {
    const check = (await rows<{ novel: number }>(conn, `
      SELECT COUNT(*) - SUM(lv.chinese IS NOT NULL) novel FROM sentences s
      JOIN lessons l ON l.id = s.lesson_id
      LEFT JOIN live_sent lv ON lv.chinese = s.chinese AND lv.english = s.english
      WHERE l.course_id = ?`, [t.course_id]))[0]
    if (Number(check.novel) !== 0) throw new Error(`${t.course_id} 独有句变为 ${check.novel}，中止`)
  }
  P("  兜底校验通过：目标课程确实不存在，且 A 类确实无独有内容")

  const lessons = await rows(conn, `SELECT * FROM lessons WHERE course_id IN (${ph})`, ids)
  const sents = await rows(conn, `SELECT s.* FROM sentences s JOIN lessons l ON l.id = s.lesson_id WHERE l.course_id IN (${ph})`, ids)
  console.log(`  已导出：${exportRows("orphan-a-lessons", lessons)}`)
  console.log(`  已导出：${exportRows("orphan-a-sentences", sents)}`)

  const [ds] = await conn.query(`DELETE s FROM sentences s JOIN lessons l ON l.id = s.lesson_id WHERE l.course_id IN (${ph})`, ids)
  const [dl] = await conn.query(`DELETE FROM lessons WHERE course_id IN (${ph})`, ids)
  P(`  已删除句子 ${N((ds as { affectedRows: number }).affectedRows)} · 课时 ${N((dl as { affectedRows: number }).affectedRows)}`)

  // ── 校验 ───────────────────────────────────────────────────────────────
  P("校验")
  const left = (await rows<{ n_lessons: number; n_sent: number }>(conn, `
    SELECT (SELECT COUNT(*) FROM lessons l WHERE ${ORPH}) n_lessons,
           (SELECT COUNT(*) FROM sentences s WHERE EXISTS (SELECT 1 FROM lessons l WHERE l.id = s.lesson_id AND ${ORPH})) n_sent`))[0]
  console.log(`  剩余孤儿课时 ${N(left.n_lessons)} · 孤儿句子 ${N(left.n_sent)}`)
  console.log(`  句子总量 ${N((await rows<{ n: number }>(conn, `SELECT COUNT(*) n FROM sentences`))[0].n)}`)
  console.log(`  断链 review_queue ${N((await rows<{ n: number }>(conn, `SELECT COUNT(*) n FROM review_queue r WHERE NOT EXISTS (SELECT 1 FROM sentences s WHERE s.id = r.sentence_id)`))[0].n)}`)
  await conn.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
