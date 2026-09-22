/**
 * TypeNow 课程数据修复
 *
 * 批次 1：剥离注入水印与不可见字符
 *   受污染数据的 english 里被插入一段 71 字符、字节完全相同的不可见块
 *   （U+200C/200D/2061/2062/2063/2064）。同一段水印也出现在 chinese、
 *   words[*].chinese、words[*].english、words[*].phonetic、
 *   dependency_analysis、sentence_structure 中。
 *
 *   实测 3,059 个水印块，**没有任何一个的两侧同时是非空白字符**，因此直接
 *   删除水印块不会把前后两个词粘连。据此把清洗全部下推到 MySQL 执行：
 *   零数据传输，把原本需要外传约 1.4GB 的操作变成纯服务端 UPDATE。
 *   已验证 JSON 列往返无损：JSON_VALID 1→1、JSON_LENGTH 不变、
 *   words[*].english 逐字节一致。
 *
 * 批次 2：音标回填
 *   crawl-all-julebu.cjs 用 String(w.phonetic) 把 {uk,us} 对象写成了字面量
 *   "[object Object]"。改用同一份语料里的正常音标建「词 → 音标」映射回填，
 *   回填不到的置 null（前端对空值渲染空白）。
 *   本批次需要重写 JSON，只取回 id + words 两列以压低传输量。
 *
 * 安全约定：
 *   - 默认 dry-run，只有显式 --apply 才写库。
 *   - --apply 时默认先建备份表，可用 --no-backup 跳过。
 *   - 仅修改上述 6 个字段，不动 id / 归属 / 排序 / 发布状态。
 *
 * 用法：
 *   npx tsx scripts/repair-course-data.ts                 # dry-run 全量预览
 *   npx tsx scripts/repair-course-data.ts --only=1        # 只看批次 1
 *   npx tsx scripts/repair-course-data.ts --limit=2000    # 小样本试跑
 *   npx tsx scripts/repair-course-data.ts --apply --no-backup
 *   npx tsx scripts/repair-course-data.ts --verify        # 修完复核
 */

import { createConnection, type Connection } from "mysql2/promise"
import fs from "node:fs"
import path from "node:path"

const APPLY = process.argv.includes("--apply")
const VERIFY = process.argv.includes("--verify")
const NO_BACKUP = process.argv.includes("--no-backup")
const onlyArg = process.argv.find((a) => a.startsWith("--only="))
const ONLY = onlyArg ? onlyArg.split("=")[1] : null
const limitArg = process.argv.find((a) => a.startsWith("--limit="))
const LIMIT = limitArg ? Number(limitArg.split("=")[1]) : 0

const ROOT = process.cwd()
const BAD_PHONETIC = "[object Object]"

function loadDatabaseUrl(): string {
  const text = fs.readFileSync(path.join(ROOT, ".env.local"), "utf8")
  const m = text.match(/^DATABASE_URL=(.*)$/m)
  if (!m) throw new Error("在 .env.local 中找不到 DATABASE_URL")
  return m[1].trim().replace(/^["']|["']$/g, "")
}

// ─── 清洗字符集 ──────────────────────────────────────────────────────────────
/**
 * 不可见字符。故意包含方向控制符与变体选择符：这些在任何英文/中文教学
 * 语料里都不可能是有效内容。NBSP 单独先转成普通空格（不能直接删，否则粘连）。
 */
const INVIS_CHARS = Array.from(
  new Set([
    "\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5",
    "\u180b\u180c\u180d\u180e",
    "\u200b\u200c\u200d\u200e\u200f",
    "\u202a\u202b\u202c\u202d\u202e",
    "\u2060\u2061\u2062\u2063\u2064",
    "\u2066\u2067\u2068\u2069",
    "\u3164\ufeff",
    "\ufe00\ufe01\ufe02\ufe03\ufe04\ufe05\ufe06\ufe07\ufe08\ufe09\ufe0a\ufe0b\ufe0c\ufe0d\ufe0e\ufe0f",
    "\uffa0",
  ]),
).join("")

const INVIS_PATTERN = `[${INVIS_CHARS}]+`

/**
 * 服务端清洗表达式：NBSP→空格，删除不可见块，折叠连续空格，首尾 trim。
 * NBSP 与不可见字符集都用绑定参数传入：MySQL 的 '\u00a0' 不是转义，会退化成
 * 字面量 'u00a0'，绑定参数可绕开全部反斜杠转义问题。每个字段 2 个参数。
 */
const cleanExpr = (col: string) =>
  `TRIM(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(${col}, ?, ' '), ?, ''), '  +', ' '))`

/** 一个字段清洗所需的参数序列。 */
const CLEAN_PARAMS = ["\u00a0", INVIS_PATTERN] as const
const PARAMS_PER_FIELD = CLEAN_PARAMS.length

/**
 * JSON 列版本。MySQL 的 JSON→字符串转换是紧凑格式，其中的双空格必然来自
 * 水印被删除后的残留，折叠安全；结构化字符之间不会出现连续空格。
 */
const cleanJsonExpr = (col: string) =>
  `(CASE WHEN ${col} IS NULL THEN NULL ELSE CAST(${cleanExpr(`CAST(${col} AS CHAR)`)} AS JSON) END)`

const WM_HEX = "E281A1" // U+2061，水印块内每个码点同现
const BROKEN_HEX = "5B6F626A656374204F626A6563745D" // "[object Object]"

const NBSP_HEX = "C2A0"
const HIT = (col: string, hex: string) => `HEX(CAST(${col} AS CHAR)) LIKE '%${hex}%'`

/**
 * 嵌入 SQL 的不可见字符正则字面量。字符集内不含单引号或反斜杠，可直接内联。
 * REGEXP_LIKE 在 MySQL 8 走 ICU，按码点匹配，不受 collation 影响。
 */
const INVIS_SQL = `'${INVIS_PATTERN}'`

/**
 * 判定一行是否需要清洗：任意字段含不可见字符、含 NBSP，或首尾有多余空格。
 *
 * 两个坑：
 *  1. 不能只用"含水印特征码 U+2061"判定 —— 源数据里还有孤立的 U+200B/ZWNJ 和
 *     纯尾随空格，它们不含 U+2061，会被漏掉。
 *  2. NBSP 必须用字节级 HEX 比对。INSTR/LIKE 走 collation，utf8mb4 的 ai_ci
 *     把 U+00A0 视同普通空格，`INSTR(col, NBSP)` 会命中任意含空格的行
 *     （实测 english 误报 1,498 行、全字段误报 43,804 行）。
 */
const DIRTY = (col: string) =>
  `(${col} IS NOT NULL AND (REGEXP_LIKE(${col}, ${INVIS_SQL})` +
  ` OR HEX(CAST(${col} AS CHAR)) LIKE '%${NBSP_HEX}%'` +
  ` OR ${col} LIKE ' %' OR ${col} LIKE '% '))`

const COLS = {
  english: "english",
  chinese: "chinese",
  words: "words",
  chunks: "chunks",
  dep: "dependency_analysis",
  ss: "sentence_structure",
} as const
const TEXT_FIELDS = ["english", "chinese"] as const
const JSON_FIELDS = ["words", "chunks", "dep", "ss"] as const
const ALL_FIELDS = [...TEXT_FIELDS, ...JSON_FIELDS] as const

/** 批次 1 受影响：任一字段含水印/不可见字符/NBSP/首尾空格。 */
const BATCH1_WHERE = ALL_FIELDS.map((k) => DIRTY(COLS[k])).join(" OR ")

/** 批次 2 受影响：words 里的 phonetic 是字面量 "[object Object]"。 */
const BATCH2_WHERE = `JSON_LENGTH(words) > 0 AND ${HIT("JSON_EXTRACT(words,'$[*].phonetic')", BROKEN_HEX)}`

// ─── 基础工具 ────────────────────────────────────────────────────────────────

const fmt = (n: number) => n.toLocaleString("en-US")
const t0 = Date.now()
const elapsed = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`
const log = (...a: unknown[]) => console.log(...a)

async function fetchIds(conn: Connection, where: string, limit = 0): Promise<string[]> {
  const sql = `SELECT id FROM sentences WHERE ${where} ORDER BY id${limit > 0 ? ` LIMIT ${limit}` : ""}`
  const [rows] = await conn.query(sql)
  return (rows as { id: string }[]).map((r) => r.id)
}

function parseJson(v: unknown): unknown {
  if (v === null || v === undefined) return null
  if (typeof v === "string") {
    try {
      return JSON.parse(v)
    } catch {
      return v
    }
  }
  return v
}

// ─── 批次 1：服务端 SQL 清洗 ─────────────────────────────────────────────────

async function applyBatch1Sql(conn: Connection, ids: string[]) {
  const setClause = [
    ...TEXT_FIELDS.map((k) => `${COLS[k]} = ${cleanExpr(COLS[k])}`),
    ...JSON_FIELDS.map((k) => `${COLS[k]} = ${cleanJsonExpr(COLS[k])}`),
  ].join(",\n      ")
  const sql = `UPDATE sentences SET\n      ${setClause}\n    WHERE id IN (`
  const nPatternParams = ALL_FIELDS.length * PARAMS_PER_FIELD
  const chunk = 800
  let done = 0
  for (let i = 0; i < ids.length; i += chunk) {
    const slice = ids.slice(i, i + chunk)
    const params = [
      ...Array.from({ length: nPatternParams / PARAMS_PER_FIELD }, () => CLEAN_PARAMS).flat(),
      ...slice,
    ]
    await conn.query(`${sql}${slice.map(() => "?").join(",")})`, params)
    done += slice.length
    if (done % 40000 < chunk) log(`      已清洗 ${fmt(done)} / ${fmt(ids.length)}  (${elapsed()})`)
  }
}

// ─── 批次 2：音标回填 ────────────────────────────────────────────────────────

/** 从语料自身的正常音标建「词 → 音标」映射，保留原始形态（对象或字符串）。 */
async function buildPhoneticMap(conn: Connection): Promise<Map<string, unknown>> {
  const cleanIds = await fetchIds(conn, `JSON_LENGTH(words) > 0 AND NOT (${BATCH2_WHERE})`)
  log(`    正常音标样本行: ${fmt(cleanIds.length)}`)
  const map = new Map<string, unknown>()
  const chunk = 2000
  for (let i = 0; i < cleanIds.length; i += chunk) {
    const slice = cleanIds.slice(i, i + chunk)
    const [rows] = await conn.query(
      `SELECT JSON_EXTRACT(words,'$[*].english') en, JSON_EXTRACT(words,'$[*].phonetic') ph
         FROM sentences WHERE id IN (${slice.map(() => "?").join(",")})`,
      slice,
    )
    for (const r of rows as { en: unknown; ph: unknown }[]) {
      const ens = parseJson(r.en)
      const phs = parseJson(r.ph)
      if (!Array.isArray(ens) || !Array.isArray(phs)) continue
      for (let j = 0; j < ens.length; j++) {
        const key = String(ens[j] ?? "").toLowerCase()
        if (!key) continue
        const p = phs[j]
        if (!p || p === BAD_PHONETIC) continue
        if (typeof p === "object" && !(p as { uk?: string }).uk && !(p as { us?: string }).us) continue
        if (typeof p === "string" && !p.trim()) continue
        if (!map.has(key)) map.set(key, p)
      }
    }
    if (Math.floor(i / chunk) % 10 === 0) log(`      映射取样 ${fmt(i)} / ${fmt(cleanIds.length)}  (${elapsed()})`)
  }
  return map
}

interface B2Plan {
  updates: Map<string, unknown>
  stats: Record<string, number>
}

async function buildBatch2(conn: Connection, ids: string[], map: Map<string, unknown>): Promise<B2Plan> {
  const stats = { sentences: 0, brokenWords: 0, filled: 0, nulled: 0, fullyFixed: 0, stillGapped: 0 }
  const updates = new Map<string, unknown>()
  const chunk = 1500
  for (let i = 0; i < ids.length; i += chunk) {
    const slice = ids.slice(i, i + chunk)
    const [rows] = await conn.query(
      `SELECT id, words FROM sentences WHERE id IN (${slice.map(() => "?").join(",")})`,
      slice,
    )
    for (const r of rows as { id: string; words: unknown }[]) {
      const words = parseJson(r.words)
      if (!Array.isArray(words)) continue
      let changed = false
      let gap = false
      for (const w of words as { english?: string; phonetic?: unknown }[]) {
        if (w?.phonetic !== BAD_PHONETIC) continue
        stats.brokenWords++
        const hit = map.get(String(w.english ?? "").toLowerCase())
        if (hit !== undefined) {
          w.phonetic = hit
          stats.filled++
        } else {
          w.phonetic = null
          stats.nulled++
          gap = true
        }
        changed = true
      }
      if (changed) {
        stats.sentences++
        if (gap) stats.stillGapped++
        else stats.fullyFixed++
        updates.set(r.id, words)
      }
    }
    if (Math.floor(i / chunk) % 10 === 0) log(`      已计算 ${fmt(i)} / ${fmt(ids.length)}  (${elapsed()})`)
  }
  return { updates, stats }
}

/** 只回写 words 一列，走临时表 JOIN。 */
async function applyWordsUpdates(conn: Connection, updates: Map<string, unknown>) {
  const entries = Array.from(updates.entries())
  await conn.query(`DROP TEMPORARY TABLE IF EXISTS _stage_words`)
  await conn.query(`CREATE TEMPORARY TABLE _stage_words (id VARCHAR(36) NOT NULL PRIMARY KEY, words JSON NOT NULL)`)
  const chunk = 500
  for (let i = 0; i < entries.length; i += chunk) {
    const slice = entries.slice(i, i + chunk)
    await conn.query(
      `INSERT INTO _stage_words (id, words) VALUES ${slice.map(() => "(?,?)").join(",")}`,
      slice.flatMap(([id, w]) => [id, JSON.stringify(w)]),
    )
    if (i % 30000 < chunk) log(`      已暂存 ${fmt(Math.min(i + chunk, entries.length))} / ${fmt(entries.length)}  (${elapsed()})`)
  }
  await conn.query(`UPDATE sentences s JOIN _stage_words t ON s.id = t.id SET s.words = t.words`)
  await conn.query(`DROP TEMPORARY TABLE IF EXISTS _stage_words`)
}

// ─── 备份（可选） ───────────────────────────────────────────────────────────

async function buildBackup(conn: Connection, ids: string[]) {
  const ts = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14)
  const table = `sentences_repair_backup_${ts}`
  const union = Array.from(new Set(ids)).sort()
  log(`\n[备份] ${fmt(union.length)} 行 → ${table}`)
  await conn.query(`CREATE TABLE ${table} (
    id VARCHAR(36) NOT NULL PRIMARY KEY,
    english MEDIUMTEXT NULL, chinese MEDIUMTEXT NULL,
    words JSON NULL, chunks JSON NULL,
    dependency_analysis JSON NULL, sentence_structure JSON NULL
  )`)
  const chunk = 500
  for (let i = 0; i < union.length; i += chunk) {
    const slice = union.slice(i, i + chunk)
    await conn.query(
      `INSERT INTO ${table} (id, english, chinese, words, chunks, dependency_analysis, sentence_structure)
       SELECT id, english, chinese, words, chunks, dependency_analysis, sentence_structure
       FROM sentences WHERE id IN (${slice.map(() => "?").join(",")})`,
      slice,
    )
    if (i % 40000 < chunk) log(`      已备份 ${fmt(Math.min(i + chunk, union.length))} / ${fmt(union.length)}  (${elapsed()})`)
  }
  log(`[备份] 完成 (${elapsed()})`)
  log(`[备份] 回滚：UPDATE sentences s JOIN ${table} b ON s.id = b.id SET
         s.english=COALESCE(b.english,s.english), s.chinese=COALESCE(b.chinese,s.chinese),
         s.words=COALESCE(b.words,s.words), s.chunks=COALESCE(b.chunks,s.chunks),
         s.dependency_analysis=COALESCE(b.dependency_analysis,s.dependency_analysis),
         s.sentence_structure=COALESCE(b.sentence_structure,s.sentence_structure)`)
  return table
}

// ─── 复核 ───────────────────────────────────────────────────────────────────

async function verify(conn: Connection) {
  log("\n[复核]")
  const [rows] = await conn.query(`SELECT
    (SELECT COUNT(*) FROM sentences) total,
    (SELECT COUNT(*) FROM sentences WHERE ${BATCH1_WHERE}) b1_left,
    (SELECT COUNT(*) FROM sentences WHERE ${BATCH2_WHERE}) b2_left,
    (SELECT COUNT(*) FROM sentences WHERE ${HIT("english", WM_HEX)}) en_wm,
    (SELECT COUNT(*) FROM sentences WHERE ${HIT("chinese", WM_HEX)}) zh_wm,
    (SELECT COUNT(*) FROM sentences WHERE ${HIT("dependency_analysis", WM_HEX)}) dep_wm,
    (SELECT COUNT(*) FROM sentences WHERE ${HIT("sentence_structure", WM_HEX)}) ss_wm,
    (SELECT COUNT(*) FROM sentences WHERE ${HIT("JSON_EXTRACT(words,'$[*].english')", WM_HEX)}) w_en_wm,
    (SELECT COUNT(*) FROM sentences WHERE ${HIT("JSON_EXTRACT(chunks,'$[*].text')", WM_HEX)}) c_tx_wm,
    (SELECT COUNT(*) FROM sentences WHERE JSON_VALID(words) = 0) bad_json`)
  const r = (rows as Record<string, number>[])[0]
  const ok = (n: unknown) => (Number(n) === 0 ? "✓ 0" : `✗ ${fmt(Number(n))}`)
  log(`    句子总数                 ${fmt(Number(r.total))}`)
  log(`    批次1 残留               ${ok(r.b1_left)}`)
  log(`    批次2 残留               ${ok(r.b2_left)}`)
  log(`    english                  ${ok(r.en_wm)}`)
  log(`    chinese                  ${ok(r.zh_wm)}`)
  log(`    dependency_analysis      ${ok(r.dep_wm)}`)
  log(`    sentence_structure       ${ok(r.ss_wm)}`)
  log(`    words[].english  ← 打字   ${ok(r.w_en_wm)}`)
  log(`    chunks[].text    ← 打字   ${ok(r.c_tx_wm)}`)
  log(`    JSON 非法行              ${ok(r.bad_json)}`)
  log(`\n耗时 ${elapsed()}`)
}

// ─── 主流程 ──────────────────────────────────────────────────────────────────

async function main() {
  const conn = await createConnection(loadDatabaseUrl())
  log("=== TypeNow 课程数据修复 ===")
  log(`模式: ${APPLY ? "★ APPLY（会写库）" : "dry-run（只读预览）"}${VERIFY ? " + verify" : ""}${LIMIT ? `  limit=${LIMIT}` : ""}`)

  if (VERIFY) {
    await verify(conn)
    await conn.end()
    return
  }

  log("\n[0] 统计受影响行")
  const ids1 = ONLY === "2" ? [] : await fetchIds(conn, BATCH1_WHERE, LIMIT)
  if (ONLY !== "2") log(`    批次 1（水印/不可见字符）: ${fmt(ids1.length)} 行  (${elapsed()})`)
  const ids2 = ONLY === "1" ? [] : await fetchIds(conn, BATCH2_WHERE, LIMIT)
  if (ONLY !== "1") log(`    批次 2（音标 [object Object]）: ${fmt(ids2.length)} 行  (${elapsed()})`)
  const [tr] = await conn.query(`SELECT COUNT(*) n FROM sentences`)
  log(`    全库句子: ${fmt(Number((tr as Record<string, number>[])[0].n))}`)

  if (!APPLY) {
    log("\n[试算样例] 直接用与写入完全相同的 SQL 表达式求值")
    // 逐字段求值并标出是哪个字段触发了清洗，避免“看起来没变化”的误判。
    const sel = ALL_FIELDS.map((k) => {
      const e = k === "words" || k === "chunks" || k === "dep" || k === "ss" ? cleanJsonExpr(COLS[k]) : cleanExpr(COLS[k])
      return `CAST(${COLS[k]} AS CHAR) AS before_${k}, CAST(${e} AS CHAR) AS after_${k}`
    }).join(",\n              ")
    const preview = await conn.query(
      `SELECT id, ${sel} FROM sentences WHERE ${BATCH1_WHERE} ORDER BY id LIMIT 3`,
      Array.from({ length: ALL_FIELDS.length }, () => CLEAN_PARAMS).flat(),
    )
    for (const r of preview[0] as Record<string, unknown>[]) {
      log(`\n    id=${r.id}`)
      for (const k of ALL_FIELDS) {
        const b = r[`before_${k}`] as string | null
        const a = r[`after_${k}`] as string | null
        const mark = b !== a ? "✎ 已修" : "  "
        log(`      ${mark} ${k.padEnd(19)} ${JSON.stringify((b ?? "").slice(0, 58))}`)
        if (b !== a) log(`         ${" ".repeat(23)}→ ${JSON.stringify((a ?? "").slice(0, 58))}`)
      }
    }
    const [j] = await conn.query(
      `SELECT JSON_VALID(words) v1,
              JSON_VALID(${cleanJsonExpr("words")}) v2,
              JSON_LENGTH(words) l1,
              JSON_LENGTH(${cleanJsonExpr("words")}) l2
       FROM sentences WHERE ${BATCH2_WHERE} LIMIT 1`,
      [...CLEAN_PARAMS, ...CLEAN_PARAMS],
    )
    const jr = (j as Record<string, unknown>[])[0]
    if (jr) log(`\n    JSON 往返自检: JSON_VALID ${jr.v1}→${jr.v2} · JSON_LENGTH ${jr.l1}→${jr.l2}`)
    else log(`\n    JSON 往返自检: 已无坏音标行，跳过`)
    log(`\n（dry-run 结束，未修改任何数据；加 --apply 执行。耗时 ${elapsed()}）`)
    await conn.end()
    return
  }

  if (!NO_BACKUP) await buildBackup(conn, [...ids1, ...ids2])
  else log("\n[备份] 已按 --no-backup 跳过")

  if (ONLY !== "2") {
    log(`\n[批次 1] 服务端 SQL 清洗 ${fmt(ids1.length)} 行`)
    await applyBatch1Sql(conn, ids1)
    log(`    完成  (${elapsed()})`)
  }

  if (ONLY !== "1") {
    log("\n[批次 2] 音标回填")
    const map = await buildPhoneticMap(conn)
    log(`    词→音标 映射: ${fmt(map.size)} 条  (${elapsed()})`)
    const { updates, stats } = await buildBatch2(conn, ids2, map)
    log(`    待更新 ${fmt(stats.sentences)} 行`)
    log(`      坏音标词次 ${fmt(stats.brokenWords)}`)
    log(`      成功回填   ${fmt(stats.filled)}  (${((stats.filled / Math.max(1, stats.brokenWords)) * 100).toFixed(1)}%)`)
    log(`      置 null    ${fmt(stats.nulled)}  (${((stats.nulled / Math.max(1, stats.brokenWords)) * 100).toFixed(1)}%)`)
    log(`      整句修好   ${fmt(stats.fullyFixed)} / 仍有缺口 ${fmt(stats.stillGapped)}`)
    await applyWordsUpdates(conn, updates)
    log(`    已写库  (${elapsed()})`)
  }

  await verify(conn)
  await conn.end()
}

main().catch((e) => {
  console.error("\n执行失败:", (e as Error).message)
  console.error((e as Error).stack?.split("\n").slice(0, 4).join("\n"))
  process.exitCode = 1
})
