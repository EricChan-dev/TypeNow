/**
 * 课程内容清理：同一课时内的重复句 + 空课时 + 悬空句
 *
 * 用法：
 *   npx tsx scripts/repair-duplicates.ts              # 只读 dry-run（默认）
 *   npx tsx scripts/repair-duplicates.ts --apply      # 真正执行
 *   npx tsx scripts/repair-duplicates.ts --only=dup   # 只处理某一类
 *
 * 三类问题与处理口径：
 *
 * 1) 同一课时内的完全重复句（chinese+english 相同）
 *    用户在同一个课时里会把同一句话练很多遍。重复行散落在不同 sort_order，
 *    不是连续插入的产物。保留规则：优先保留 words 非空的那一行（避免把已解析
 *    好的音标/词性丢掉），其次 sort_order 最小，最后 id 最小。
 *
 *    跨课时的重复**不处理**。实测同课程同名课时 1,735 对里只有 1 对句子集相同，
 *    其余 1,697 对完全不重叠 —— 说明跨课时重复是课程之间正常复用素材，删了会
 *    破坏课程结构。
 *
 * 2) 空课时（一个句子都没有）
 *    课时表没有 is_published 列，只要所属课程已发布，用户就能点进去看到空白页。
 *    实测 36 个全部落在已发布课程里，且同一系列的其他编号都有内容，属于抓取时
 *    源站本身就没句子的残桩。没有任何句子，删除不丢内容。
 *
 * 3) 悬空句（lesson_id 指向不存在的课时）
 *    纯垃圾，永远不可达。
 *
 * 明确不动：孤儿课时（course_id 指向不存在的课程，1,712 个 / 含 48,463 句）。
 * 它们是「课程被删但课时留下」，不可达但内容完整，删除属于内容取舍，另行决策。
 */

import { createConnection, type Connection } from "mysql2/promise"
import fs from "node:fs"
import path from "node:path"
import zlib from "node:zlib"

const APPLY = process.argv.includes("--apply")
const ONLY = process.argv.find((a) => a.startsWith("--only="))?.split("=")[1]
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
  const [r] = await c.query(sql, p)
  return r as T[]
}

/** 把要删的行完整导出，作为不可逆删除的安全网。 */
function exportRows(name: string, data: unknown[]): string {
  if (!data.length) return "(空)"
  fs.mkdirSync(EXPORT_DIR, { recursive: true })
  const file = path.join(EXPORT_DIR, `${name}.jsonl.gz`)
  const lines = data.map((r) => JSON.stringify(r)).join("\n")
  fs.writeFileSync(file, zlib.gzipSync(lines))
  return `${file} (${(fs.statSync(file).size / 1024 / 1024).toFixed(1)} MB, ${N(data.length)} 行)`
}

async function main() {
  const conn = await createConnection({ uri: dbUrl(), connectTimeout: 30000 })
  console.log(APPLY ? "模式：APPLY（会真正删除）" : "模式：DRY-RUN（只读，不改任何数据）")
  if (ONLY) console.log(`范围：--only=${ONLY}`)

  const before = (await rows<{ n: number; lessons: number }>(conn, "SELECT COUNT(*) n, COUNT(DISTINCT lesson_id) lessons FROM sentences"))[0]
  P(`清理前：句子 ${N(before.n)}（分布在 ${N(before.lessons)} 个课时）`)

  // ── 1) 同一课时内的重复句 ────────────────────────────────────────────────
  if (!ONLY || ONLY === "dup") {
    P("① 同一课时内的重复句 — 建立 id → 保留行 的映射")
    await conn.query(`DROP TEMPORARY TABLE IF EXISTS dup_map`)
    await conn.query(`
      CREATE TEMPORARY TABLE dup_map AS
      SELECT id, FIRST_VALUE(id) OVER (
          PARTITION BY lesson_id, chinese, english
          ORDER BY (COALESCE(JSON_LENGTH(words), 0) > 0) DESC, sort_order ASC, id ASC
        ) AS keep_id
      FROM sentences`)
    await conn.query(`DELETE FROM dup_map WHERE id = keep_id`)
    await conn.query(`ALTER TABLE dup_map ADD PRIMARY KEY (id)`)

    const dup = (await rows<{ n: number }>(conn, "SELECT COUNT(*) n FROM dup_map"))[0]
    const lossy = (await rows<{ n: number }>(conn, `SELECT COUNT(*) n FROM sentences s JOIN dup_map m ON m.id = s.id
      WHERE COALESCE(JSON_LENGTH(s.words), 0) > 0
        AND COALESCE(JSON_LENGTH((SELECT x.words FROM sentences x WHERE x.id = m.keep_id)), 0) = 0`))[0]
    P(`   待删重复行 ${N(dup.n)} · 其中「被删行有 words 但保留行没有」的 ${N(lossy.n)} 行（应为 0）`)

    const affLessons = (await rows<{ n: number }>(conn, `SELECT COUNT(DISTINCT s.lesson_id) n FROM sentences s JOIN dup_map m ON m.id = s.id`))[0]
    P(`   涉及课时 ${N(affLessons.n)} 个`)

    // review_queue 指向待删行时改指向保留行（外键不存在，不处理会留下断链）
    const rq = await rows<{ id: string; user_id: string; sentence_id: string }>(conn, `
      SELECT r.id, r.user_id, r.sentence_id, m.keep_id FROM review_queue r JOIN dup_map m ON m.id = r.sentence_id`)
    if (rq.length) {
      P(`   review_queue 有 ${N(rq.length)} 行指向待删句，改指向保留行`)
      for (const r of rq) {
        const clash = await rows<{ n: number }>(conn, `SELECT COUNT(*) n FROM review_queue WHERE user_id = ? AND sentence_id = ?`, [r.user_id, r.keep_id])
        if (Number(clash[0].n) > 0) {
          // 该用户对保留行已有复习条目，直接删掉这条冗余的
          if (APPLY) await conn.query(`DELETE FROM review_queue WHERE id = ?`, [r.id])
          console.log(`     · 用户 ${r.user_id.slice(0, 8)}… 对保留行已有条目 → 删除冗余条目 ${r.id.slice(0, 8)}…`)
        } else {
          if (APPLY) await conn.query(`UPDATE review_queue SET sentence_id = ? WHERE id = ?`, [r.keep_id, r.id])
          console.log(`     · 用户 ${r.user_id.slice(0, 8)}… 复习条目改指向保留行`)
        }
      }
    } else {
      P(`   review_queue 无受影响行`)
    }


    if (APPLY) {
      const data = await rows(conn, `SELECT s.* FROM sentences s JOIN dup_map m ON m.id = s.id`)
      console.log(`   已导出待删内容：${exportRows("duplicate-sentences", data)}`)
      P(`   执行删除…`)
      const [res] = await conn.query(`DELETE s FROM sentences s JOIN dup_map m ON m.id = s.id`)
      P(`   已删除 ${N((res as { affectedRows: number }).affectedRows)} 行`)
    } else {
      const sample = await rows(conn, `SELECT s.lesson_id, s.chinese, s.english, s.sort_order, s.id,
          (SELECT COUNT(*) FROM sentences x WHERE x.lesson_id=s.lesson_id AND x.chinese=s.chinese AND x.english=s.english) cnt
        FROM sentences s JOIN dup_map m ON m.id = s.id ORDER BY cnt DESC LIMIT 5`)
      for (const r of sample) {
        console.log(`     ×${r.cnt} so=${r.sort_order} ${JSON.stringify(String(r.chinese).replace(/\n/g, "\\n").slice(0, 26))} → ${JSON.stringify(String(r.english).slice(0, 40))}`)
      }
    }
  }

  // ── 2) 空课时 ───────────────────────────────────────────────────────────
  if (!ONLY || ONLY === "empty") {
    P("② 空课时")
    const empty = await rows<{ id: string; title: string; course: string; is_published: number }>(conn, `
      SELECT l.id, l.title, c.title course, c.is_published
      FROM lessons l JOIN courses c ON c.id = l.course_id
      WHERE NOT EXISTS (SELECT 1 FROM sentences s WHERE s.lesson_id = l.id)`)
    const pub = empty.filter((e) => Number(e.is_published) === 1).length
    P(`   空课时 ${N(empty.length)} 个（已发布课程下 ${N(pub)} 个）`)
    if (APPLY) {
      console.log(`   已导出待删内容：${exportRows("empty-lessons", empty)}`)
      const ids = empty.map((e) => e.id)
      let deleted = 0
      for (let i = 0; i < ids.length; i += 500) {
        const chunk = ids.slice(i, i + 500)
        const ph = chunk.map(() => "?").join(",")
        // 再确认一次「此刻仍然没有句子」，避免与并发导入抢跑
        const [res] = await conn.query(
          `DELETE FROM lessons WHERE id IN (${ph})
             AND NOT EXISTS (SELECT 1 FROM sentences s WHERE s.lesson_id = lessons.id)`, chunk)
        deleted += (res as { affectedRows: number }).affectedRows
      }
      P(`   已删除 ${N(deleted)} 个空课时`)
    }
  }

  // ── 3) 悬空句 ───────────────────────────────────────────────────────────
  if (!ONLY || ONLY === "orphan") {
    P("③ 悬空句（lesson_id 指向不存在的课时）")
    const orphan = await rows<{ id: string }>(conn, `
      SELECT s.id FROM sentences s WHERE NOT EXISTS (SELECT 1 FROM lessons l WHERE l.id = s.lesson_id)`)
    P(`   悬空句 ${N(orphan.length)} 条`)
    if (orphan.length && APPLY) {
      const data = await rows(conn, `SELECT s.* FROM sentences s WHERE NOT EXISTS (SELECT 1 FROM lessons l WHERE l.id = s.lesson_id)`)
      console.log(`   已导出待删内容：${exportRows("orphan-sentences", data)}`)
      const [res] = await conn.query(`DELETE s FROM sentences s WHERE NOT EXISTS (SELECT 1 FROM lessons l WHERE l.id = s.lesson_id)`)
      P(`   已删除 ${N((res as { affectedRows: number }).affectedRows)} 条`)
    }
  }

  // ── 校验 ────────────────────────────────────────────────────────────────
  P("校验")
  const residual = (await rows<{ n: number }>(conn, `SELECT COUNT(*) n FROM (
      SELECT lesson_id, chinese, english, COUNT(*) c FROM sentences
      GROUP BY lesson_id, chinese, english HAVING c > 1) t`))[0]
  const emptyLeft = (await rows<{ n: number; pub: number }>(conn, `SELECT COUNT(*) n,
      SUM(c.is_published = 1) pub FROM lessons l JOIN courses c ON c.id = l.course_id
      WHERE NOT EXISTS (SELECT 1 FROM sentences s WHERE s.lesson_id = l.id)`))[0]
  const orphanLeft = (await rows<{ n: number }>(conn, `SELECT COUNT(*) n FROM sentences s
      WHERE NOT EXISTS (SELECT 1 FROM lessons l WHERE l.id = s.lesson_id)`))[0]
  const brokenRq = (await rows<{ n: number }>(conn, `SELECT COUNT(*) n FROM review_queue r
      WHERE NOT EXISTS (SELECT 1 FROM sentences s WHERE s.id = r.sentence_id)`))[0]
  const after = (await rows<{ n: number }>(conn, "SELECT COUNT(*) n FROM sentences"))[0]
  console.log(`  同课时重复组 剩余 ${N(residual.n)}   空课时 剩余 ${N(emptyLeft.n)}（已发布 ${N(emptyLeft.pub ?? 0)}）`)
  console.log(`  悬空句 剩余 ${N(orphanLeft.n)}   review_queue 断链 ${N(brokenRq.n)}`)
  console.log(`  句子总量 ${N(before.n)} → ${N(after.n)}（减少 ${N(before.n - after.n)}）`)
  if (!APPLY) console.log("\n以上为 DRY-RUN，未修改任何数据。加 --apply 执行。")
  await conn.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
