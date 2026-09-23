/**
 * 残留数据收尾（默认只读，--apply 才写入）
 *
 * 处理 5 项已确认的残留，全部先导出后写入，单个事务，失败回滚。
 *
 * 用法：
 *   npx tsx scripts/cleanup-residual.ts           # 只读：打印计划
 *   npx tsx scripts/cleanup-residual.ts --apply   # 执行
 */

import { createConnection, type Connection } from "mysql2/promise"
import fs from "node:fs"
import zlib from "node:zlib"

const APPLY = process.argv.includes("--apply")
const EXPORT_DIR = "content-deleted"

function dbUrl(): string {
  const m = fs.readFileSync(".env.local", "utf8").match(/^DATABASE_URL=(.*)$/m)
  if (!m) throw new Error(".env.local 里找不到 DATABASE_URL")
  return m[1].trim()
}

const t0 = Date.now()
const P = (s: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] ${s}`)
const N = (n: unknown) => Number(n).toLocaleString("en-US")

async function rows<T = Record<string, unknown>>(c: Connection, sql: string, p?: unknown[]): Promise<T[]> {
  const [r] = await c.execute(sql, p)
  return r as T[]
}

function exportGz(name: string, data: unknown[]) {
  fs.mkdirSync(EXPORT_DIR, { recursive: true })
  const f = `${EXPORT_DIR}/${name}.jsonl.gz`
  fs.writeFileSync(f, zlib.gzipSync(data.map((r) => JSON.stringify(r)).join("\n")))
  const mb = (fs.statSync(f).size / 1024 / 1024).toFixed(2)
  console.log(`     导出 ${f} (${N(data.length)} 行, ${mb} MB)`)
}

/** 删除一门「真实课程」的全部内容与课程行 */
async function deleteCourse(c: Connection, id: string, tag: string) {
  const [course] = await rows(c, `SELECT * FROM courses WHERE id = ?`, [id])
  const lessons = await rows(c, `SELECT * FROM lessons WHERE course_id = ? ORDER BY sort_order, id`, [id])
  const sentences = await rows(
    c,
    `SELECT s.* FROM sentences s JOIN lessons l ON l.id = s.lesson_id WHERE l.course_id = ?`,
    [id]
  )
  const rq = await rows(
    c,
    `SELECT r.* FROM review_queue r JOIN sentences s ON s.id = r.sentence_id
     JOIN lessons l ON l.id = s.lesson_id WHERE l.course_id = ?`,
    [id]
  )
  const wb = await rows(
    c,
    `SELECT w.* FROM wordbook_items w JOIN sentences s ON s.id = w.source_sentence_id
     JOIN lessons l ON l.id = s.lesson_id WHERE l.course_id = ?`,
    [id]
  )
  const prog = await rows(c, `SELECT * FROM user_course_progress WHERE course_id = ?`, [id])

  console.log(
    `   ${tag} ${JSON.stringify((course as { title?: string })?.title ?? "(课程行不存在)")} ` +
      `→ 课时 ${N(lessons.length)} · 句子 ${N(sentences.length)} · ` +
      `review_queue ${N(rq.length)} · wordbook ${N(wb.length)} · progress ${N(prog.length)}`
  )
  if (rq.length || wb.length || prog.length) {
    throw new Error(`目标仍有用户数据（review_queue ${rq.length} / wordbook ${wb.length} / progress ${prog.length}），中止`)
  }
  if (sentences.length) {
    await c.query(
      `DELETE s FROM sentences s JOIN lessons l ON l.id = s.lesson_id WHERE l.course_id = ?`,
      [id]
    )
  }
  await c.execute(`DELETE FROM lessons WHERE course_id = ?`, [id])
  await c.execute(`DELETE FROM courses WHERE id = ?`, [id])
  return { course, lessons, sentences }
}

/** 删除孤儿课程的课时（courses 里没有对应行） */
async function deleteOrphanLessons(c: Connection, id: string, tag: string) {
  const lessons = await rows(c, `SELECT * FROM lessons WHERE course_id = ? ORDER BY sort_order, id`, [id])
  const sentences = await rows(
    c,
    `SELECT s.* FROM sentences s JOIN lessons l ON l.id = s.lesson_id WHERE l.course_id = ?`,
    [id]
  )
  console.log(`   ${tag} 孤儿课程 → 课时 ${N(lessons.length)} · 句子 ${N(sentences.length)}`)
  if (sentences.length) {
    await c.query(
      `DELETE s FROM sentences s JOIN lessons l ON l.id = s.lesson_id WHERE l.course_id = ?`,
      [id]
    )
  }
  await c.execute(`DELETE FROM lessons WHERE course_id = ?`, [id])
  return { course: null, lessons, sentences }
}

async function main() {
  const c = await createConnection(dbUrl())

  P("定位目标")
  const find = async (prefix: string) => {
    const [r] = await rows<{ id: string; title: string; is_published: number }>(
      c,
      `SELECT id, title, is_published FROM courses WHERE id LIKE CONCAT(?, '%')`,
      [prefix]
    )
    return r
  }
  const dup = await find("7c769089") // 与 50601c7c 逐句完全相同的重复课程
  const fake = await find("51a7a0bb") // 15 课时 AI 编造内容，冒充新概念第二册
  const shell = await find("811b8207") // 0 课时未发布空壳，无孤儿对应
  // 孤儿课程在 courses 里没有行，必须从前缀解析出完整 course_id 才能精确定位课时
  const [orphan] = await rows<{ course_id: string }>(
    c,
    `SELECT DISTINCT course_id FROM lessons WHERE course_id LIKE CONCAT(?, '%')`,
    ["603f6c6c"]
  )
  const orphanLessons = orphan
    ? Number((await rows<{ n: number }>(c, `SELECT COUNT(*) AS n FROM lessons WHERE course_id = ?`, [orphan.course_id]))[0].n)
    : 0
  const [orphanProg] = await rows<{ id: string; user_id: string; course_id: string }>(
    c,
    `SELECT id, user_id, course_id FROM user_course_progress p
     WHERE NOT EXISTS (SELECT 1 FROM courses c WHERE c.id = p.course_id)`
  )

  console.log(`\n${"=".repeat(96)}`)
  console.log("残留收尾计划")
  console.log("=".repeat(96))
  console.log(`\n① 删除重复课程 ${dup?.id ?? "未找到"}`)
  console.log(`   ${JSON.stringify(dup?.title ?? "")} — 与保留的 50601c7c 内容指纹完全相同（687/687 句全等）`)
  console.log(`\n② 下架假内容课程 ${fake?.id ?? "未找到"}`)
  console.log(`   ${JSON.stringify(fake?.title ?? "")} — 15 课时 / 132 句，L7–L15 标题与正文均为编造，与真 NCE2 0 句重合`)
  console.log(`   处置：is_published = 0（不删除，可随时恢复）`)
  console.log(`\n③ 删除剩余孤儿课程课时 ${orphan?.course_id ?? "未找到"}（${N(orphanLessons)} 课时）`)
  console.log(`   21 单元通用词汇表，内容已被多门已发布词汇课覆盖（雅思正序 660 / 乱序 621 / 六级 586）`)
  console.log(`\n④ 删除未使用空壳课程 ${shell?.id ?? "未找到"}`)
  console.log(`   ${JSON.stringify(shell?.title ?? "")} — 0 课时、未发布、无任何孤儿对应`)
  console.log(`\n⑤ 删除孤儿 user_course_progress ${orphanProg?.id ?? "未找到"}`)
  console.log(`   用户 ${orphanProg?.user_id ?? "?"}，课程 ${orphanProg?.course_id ?? "?"}（该课程早已不存在，创建于 2026-06-09）`)

  if (!APPLY) {
    console.log("\n当前为只读模式。执行写入请加 --apply。")
    await c.end()
    return
  }

  // ---------- 写入 ----------
  P("开始写入")
  const undo: Record<string, unknown> = { createdAt: new Date().toISOString() }
  await c.beginTransaction()
  try {
    if (dup?.id) {
      console.log(`   ① 删除重复课程 ${dup.id}`)
      const d = await deleteCourse(c, dup.id, "重复课程")
      exportGz("dup-course-gaokao688", [d.course, ...d.lessons, ...d.sentences])
      undo.dupCourse = d
    }
    if (fake?.id) {
      const [n] = await rows<{ n: number }>(
        c,
        `SELECT COUNT(*) AS n FROM sentences s JOIN lessons l ON l.id = s.lesson_id WHERE l.course_id = ?`,
        [fake.id]
      )
      console.log(`   ② 下架假内容课程 ${fake.id}（${N(n.n)} 句，仅改 is_published，不删内容）`)
      await c.execute(`UPDATE courses SET is_published = 0 WHERE id = ?`, [fake.id])
      exportGz(
        "fake-nce2-51a7a0bb-sentences",
        await rows(c, `SELECT s.* FROM sentences s JOIN lessons l ON l.id = s.lesson_id WHERE l.course_id = ?`, [fake.id])
      )
      undo.unpublishedCourse = { id: fake.id, title: fake.title }
    }
    if (orphan) {
      console.log(`   ③ 删除剩余孤儿课程课时 ${orphan.course_id}`)
      const o = await deleteOrphanLessons(c, orphan.course_id, "剩余孤儿")
      exportGz("orphan-603f6c6c", [...o.lessons, ...o.sentences])
      undo.orphan603f6c6c = o
    }
    if (shell?.id) {
      console.log(`   ④ 删除未使用空壳课程 ${shell.id}`)
      const s = await deleteCourse(c, shell.id, "空壳课程")
      exportGz("shell-811b8207", [s.course, ...s.lessons, ...s.sentences])
      undo.deletedShell = s
    }
    if (orphanProg?.id) {
      console.log(`   ⑤ 删除孤儿 progress ${orphanProg.id}`)
      await c.execute(`DELETE FROM user_course_progress WHERE id = ?`, [orphanProg.id])
      undo.deletedProgress = orphanProg
    }
    await c.commit()
    console.log("   提交完成")
  } catch (e) {
    await c.rollback()
    console.error("   已回滚：", e)
    await c.end()
    process.exit(1)
  }
  fs.mkdirSync(EXPORT_DIR, { recursive: true })
  fs.writeFileSync(`${EXPORT_DIR}/cleanup-residual-undo.json`, JSON.stringify(undo, null, 2))
  console.log(`   回滚信息 → ${EXPORT_DIR}/cleanup-residual-undo.json`)

  P("写入后校验")
  const one = async (sql: string, p?: unknown[]) => Number((await rows<{ n: number }>(c, sql, p))[0].n)
  const delCourse = (undo.dupCourse as { lessons?: unknown[] })?.lessons?.length ?? 0
  const delCourseSent = (undo.dupCourse as { sentences?: unknown[] })?.sentences?.length ?? 0
  const delShellCourse = (undo.deletedShell as { course?: unknown })?.course ? 1 : 0
  const delOrphanLessons = (undo.orphan603f6c6c as { lessons?: unknown[] })?.lessons?.length ?? 0
  const delOrphanSent = (undo.orphan603f6c6c as { sentences?: unknown[] })?.sentences?.length ?? 0
  console.log(`   本次删除：课程行 ${N(delCourse + delShellCourse)} · 课时 ${N(delCourse + delOrphanLessons)} · 句子 ${N(delCourseSent + delOrphanSent)}`)
  console.log(`   课程总量 ${N(await one(`SELECT COUNT(*) AS n FROM courses`))}`)
  console.log(`   已发布课程 ${N(await one(`SELECT COUNT(*) AS n FROM courses WHERE is_published = 1`))}`)
  console.log(`   课时总量 ${N(await one(`SELECT COUNT(*) AS n FROM lessons`))}`)
  console.log(`   句子总量 ${N(await one(`SELECT COUNT(*) AS n FROM sentences`))}`)
  console.log(`   孤儿课时 ${N(await one(`SELECT COUNT(*) AS n FROM lessons l WHERE NOT EXISTS (SELECT 1 FROM courses c WHERE c.id = l.course_id)`))}（应 0）`)
  console.log(`   零课时课程 ${N(await one(`SELECT COUNT(*) AS n FROM courses c WHERE NOT EXISTS (SELECT 1 FROM lessons l WHERE l.course_id = c.id)`))}（应 0）`)
  console.log(`   空课时 ${N(await one(`SELECT COUNT(*) AS n FROM lessons l WHERE NOT EXISTS (SELECT 1 FROM sentences s WHERE s.lesson_id = l.id)`))}（应 0）`)
  console.log(`   断链句子 ${N(await one(`SELECT COUNT(*) AS n FROM sentences s WHERE NOT EXISTS (SELECT 1 FROM lessons l WHERE l.id = s.lesson_id)`))}（应 0）`)
  console.log(`   断链 review_queue ${N(await one(`SELECT COUNT(*) AS n FROM review_queue r WHERE NOT EXISTS (SELECT 1 FROM sentences s WHERE s.id = r.sentence_id)`))}（应 0）`)
  console.log(`   孤儿 progress ${N(await one(`SELECT COUNT(*) AS n FROM user_course_progress p WHERE NOT EXISTS (SELECT 1 FROM courses c WHERE c.id = p.course_id)`))}（应 0）`)
  console.log(`   已发布却 0 课时的课程 ${N(await one(`SELECT COUNT(*) AS n FROM courses c WHERE c.is_published = 1 AND NOT EXISTS (SELECT 1 FROM lessons l WHERE l.course_id = c.id)`))}（应 0）`)
  const dupLeft = await rows<{ t: string; n: number }>(
    c,
    `SELECT TRIM(title) t, COUNT(*) n FROM courses c
     WHERE NOT EXISTS (SELECT 1 FROM lessons l WHERE l.course_id = c.id)
     GROUP BY TRIM(title) HAVING n > 1`
  )
  console.log(`   零课时重名组 ${N(dupLeft.length)}（应 0）`)
  await c.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
