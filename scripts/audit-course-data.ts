/**
 * TypeNow 课程内容只读体检
 *
 * 全程只读（仅 SELECT），不修改任何数据。
 * 用法：
 *   npx tsx scripts/audit-course-data.ts            # 控制台报告
 *   npx tsx scripts/audit-course-data.ts --json     # 额外写出 content-audit.json
 *
 * 两个口径始终并列：**可达**（已发布课程下的内容，用户真能看到）与 **全库**。
 *
 * 重要实现约定：
 * 1) 判断特殊字符一律用 `HEX(CAST(col AS CHAR)) LIKE '%<utf8字节>%'`，
 *    不用 `col LIKE '%<字符>%'`。MySQL 的 utf8mb4 排序规则会把部分零宽字符
 *    视为可忽略（ignorable），LIKE 会静默多匹配，导致统计虚高。
 * 2) 打字目标不是 `sentences.english`，而是 `words[*].english`（逐词模式）
 *    与 `chunks[*].text`（分块模式）。逐层分开统计，避免把"观感问题"
 *    误判为"阻断问题"。
 */

import { createConnection } from "mysql2/promise"
import fs from "node:fs"
import path from "node:path"

const WANT_JSON = process.argv.includes("--json")
const ROOT = process.cwd()

function loadDatabaseUrl(): string {
  const envPath = path.join(ROOT, ".env.local")
  const text = fs.readFileSync(envPath, "utf8")
  const m = text.match(/^DATABASE_URL=(.*)$/m)
  if (!m) throw new Error("在 .env.local 中找不到 DATABASE_URL")
  return m[1].trim().replace(/^["']|["']$/g, "")
}

type Mark = "必修" | "重要" | "中" | "低"

interface Row {
  label: string
  all: number
  reachable: number
  /** 占比分母；未给出表示该行不适用百分比（例如基线绝对值） */
  denom?: number
  mark?: Mark
  note?: string
}

const groups: { title: string; rows: Row[] }[] = []
let current: { title: string; rows: Row[] } | null = null

function section(title: string) {
  current = { title, rows: [] }
  groups.push(current)
}

function add(
  label: string,
  all: number,
  reachable: number,
  mark?: Mark,
  note?: string,
  denom?: number,
) {
  current!.rows.push({ label, all, reachable, mark, note, denom })
}

const pct = (n: number, d: number) => (d > 0 ? `${((n / d) * 100).toFixed(1)}%` : "-")
const fmt = (n: number) => n.toLocaleString("en-US")

// ─── UTF-8 字节常量 ──────────────────────────────────────────────────────────
// 判断存在性用字节匹配，绕开排序规则的可忽略字符问题。

/** 注入水印使用的 6 个码点（实测在受污染句中同现，构成同一段 71 字符块） */
const WM = {
  zwnj: "E2808C", // U+200C
  zwj: "E2808D", // U+200D
  ifunc: "E281A1", // U+2061 INVISIBLE FUNCTION APPLICATION
  itimes: "E281A2", // U+2062 INVISIBLE TIMES
  isep: "E281A3", // U+2063 INVISIBLE SEPARATOR
  iplus: "E281A4", // U+2064 INVISIBLE PLUS
}

/** 其他不可见字符（零宽、BOM、软连字符、方向标记） */
const OTHER_INVIS = ["E2808B", "EFBBBF", "C2AD", "E2808E", "E2808F", "E281A0"]

/** 键盘打不出的排版字符（不含 NBSP） */
const TYPO = ["E28098", "E28099", "E2809C", "E2809D", "E28093", "E28094", "E280A6"]

/** NBSP（不间断空格），单独统计：它主要影响排版与 TTS，不影响能否打出来 */
const NBSP = "C2A0"

const hasBytes = (col: string, hexes: string[]) =>
  "(" + hexes.map((h) => `HEX(CAST(${col} AS CHAR)) LIKE '%${h}%'`).join(" OR ") + ")"

const REACH_JOIN = `
    JOIN lessons l ON l.id = s.lesson_id
    JOIN courses c ON c.id = l.course_id AND c.is_published = 1`

// ─── 主流程 ──────────────────────────────────────────────────────────────────

async function main() {
  const conn = await createConnection(loadDatabaseUrl())
  const q = async <T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> => {
    const [rows] = await conn.query(sql, params)
    return rows as T[]
  }
  const one = async <T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T> =>
    (await q<T>(sql, params))[0]
  const n = (o: Record<string, unknown>, k: string) => Number(o[k] ?? 0)

  const t0 = Date.now()
  console.log("=== TypeNow 课程内容只读体检 ===")
  console.log(`时间: ${new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}`)

  // ── 规模基线 ──────────────────────────────────────────────────────────────
  const base = await one<Record<string, unknown>>(`
    SELECT
      (SELECT COUNT(*) FROM courses) c,
      (SELECT COUNT(*) FROM courses WHERE is_published = 1) pc,
      (SELECT COUNT(*) FROM lessons) l,
      (SELECT COUNT(*) FROM lessons l
         JOIN courses c ON c.id = l.course_id AND c.is_published = 1) pl,
      (SELECT COUNT(*) FROM sentences) s,
      (SELECT COUNT(*) FROM sentences s ${REACH_JOIN}) ps,
      (SELECT COUNT(*) FROM sentences s ${REACH_JOIN}
         WHERE COALESCE(JSON_LENGTH(s.words), 0) > 0) ps_words,
      (SELECT COUNT(*) FROM sentences s ${REACH_JOIN}
         WHERE COALESCE(JSON_LENGTH(s.chunks), 0) > 0) ps_chunks`)

  const PS = n(base, "ps")
  const PL = n(base, "pl")
  const PS_WORDS = n(base, "ps_words")
  const PS_CHUNKS = n(base, "ps_chunks")

  section("[0] 规模基线")
  add("课程总数", n(base, "c"), 0)
  add("已发布课程", n(base, "pc"), 0)
  add("课时总数", n(base, "l"), 0)
  add("已发布课程下的课时", 0, PL)
  add("句子总数", n(base, "s"), 0)
  add("用户可达句子（已发布课程下）", 0, PS)
  add("可达句中含逐词 words 的", 0, PS_WORDS)
  add("可达句中含分块 chunks 的", 0, PS_CHUNKS)

  // ── A. 阻断性 ─────────────────────────────────────────────────────────────
  const sentAll = await one<Record<string, unknown>>(`
    SELECT
      COUNT(*) total,
      SUM(s.english IS NULL OR TRIM(s.english) = '') AS no_english,
      SUM(s.chinese IS NULL OR TRIM(s.chinese) = '') AS no_chinese,
      SUM(s.lesson_id IS NULL) AS orphan_null_lesson,
      SUM(s.english <> TRIM(s.english)) AS untrimmed,
      SUM(s.english LIKE '%  %') AS double_space,
      SUM(TRIM(s.english) = TRIM(s.chinese)) AS same_text,
      SUM(CHAR_LENGTH(s.english) > 200) AS very_long,
      SUM(CHAR_LENGTH(s.english) < 3) AS very_short,
      SUM(COALESCE(JSON_LENGTH(s.words), 0) = 0) AS no_words,
      SUM(${hasBytes("s.english", [WM.ifunc])}) AS wm_english,
      SUM(${hasBytes("s.english", OTHER_INVIS)}) AS other_invis,
      SUM(${hasBytes("s.english", TYPO)}) AS typo,
      SUM(${hasBytes("s.english", [NBSP])}) AS nbsp
    FROM sentences s`)

  const sentR = await one<Record<string, unknown>>(`
    SELECT
      COUNT(*) total,
      SUM(s.english IS NULL OR TRIM(s.english) = '') AS no_english,
      SUM(s.chinese IS NULL OR TRIM(s.chinese) = '') AS no_chinese,
      SUM(s.english <> TRIM(s.english)) AS untrimmed,
      SUM(s.english LIKE '%  %') AS double_space,
      SUM(TRIM(s.english) = TRIM(s.chinese)) AS same_text,
      SUM(CHAR_LENGTH(s.english) > 200) AS very_long,
      SUM(CHAR_LENGTH(s.english) < 3) AS very_short,
      SUM(COALESCE(JSON_LENGTH(s.words), 0) = 0) AS no_words,
      SUM(${hasBytes("s.english", [WM.ifunc])}) AS wm_english,
      SUM(${hasBytes("s.english", OTHER_INVIS)}) AS other_invis,
      SUM(${hasBytes("s.english", TYPO)}) AS typo,
      SUM(${hasBytes("s.english", [NBSP])}) AS nbsp
    FROM sentences s ${REACH_JOIN}`)

  section("[A] 阻断性 —— 用户会看到报错或空白")
  add("英文为空（练习页无法进行）", n(sentAll, "no_english"), n(sentR, "no_english"), "必修", undefined, PS)
  add("中文为空（没有题目可翻译）", n(sentAll, "no_chinese"), n(sentR, "no_chinese"), "必修", undefined, PS)
  add("英文与中文完全相同（未翻译）", n(sentAll, "same_text"), n(sentR, "same_text"), "重要", undefined, PS)
  add("lesson_id 为空（无法归属，页面取不到）", n(sentAll, "orphan_null_lesson"), 0, "必修")

  const orphan = await one<Record<string, unknown>>(`
    SELECT
      (SELECT COUNT(*) FROM lessons l LEFT JOIN courses c ON c.id = l.course_id
        WHERE c.id IS NULL) AS orphan_lessons,
      (SELECT COUNT(*) FROM sentences s LEFT JOIN lessons l ON l.id = s.lesson_id
        WHERE s.lesson_id IS NOT NULL AND l.id IS NULL) AS orphan_sentences`)
  add("孤儿课时（course_id 指向不存在的课程）", n(orphan, "orphan_lessons"), 0, "必修")
  add("孤儿句子（lesson_id 指向不存在的课时）", n(orphan, "orphan_sentences"), 0, "必修")

  const emptyLesson = await one<Record<string, unknown>>(`
    SELECT
      (SELECT COUNT(*) FROM lessons l
        LEFT JOIN sentences s ON s.lesson_id = l.id
        WHERE s.id IS NULL) AS all_empty,
      (SELECT COUNT(*) FROM lessons l
        JOIN courses c ON c.id = l.course_id AND c.is_published = 1
        LEFT JOIN sentences s ON s.lesson_id = l.id
        WHERE s.id IS NULL) AS pub_empty`)
  add(
    "空课时（没有任何句子）",
    n(emptyLesson, "all_empty"),
    n(emptyLesson, "pub_empty"),
    "必修",
    "用户点进去无内容",
    PL,
  )

  const emptyCourse = await one<Record<string, unknown>>(`
    SELECT
      (SELECT COUNT(*) FROM courses c
        LEFT JOIN lessons l ON l.course_id = c.id
        WHERE l.id IS NULL) AS no_lessons,
      (SELECT COUNT(*) FROM courses c
        WHERE c.is_published = 1 AND NOT EXISTS (
          SELECT 1 FROM lessons l JOIN sentences s ON s.lesson_id = l.id
          WHERE l.course_id = c.id)) AS pub_no_sentences`)
  add("无任何课时的课程", n(emptyCourse, "no_lessons"), 0, "必修")
  add(
    "已发布但一句内容都没有的课程",
    n(emptyCourse, "pub_no_sentences"),
    n(emptyCourse, "pub_no_sentences"),
    "必修",
    undefined,
    n(base, "pc"),
  )

  // ── B. 注入水印 —— 分字段定位 ─────────────────────────────────────────────
  // 受污染句子的 english 里被插入一段 71 字符、字节完全相同的不可见块
  // （U+200C/200D/2061/2062/2063/2064 组成）。字段不同，后果完全不同：
  //   words[*].english / chunks[*].text 被打字比对使用 -> 用户永远打不对（阻断）
  //   english / chinese / words[*].chinese 只被显示和 TTS 使用 -> 观感与成本问题
  const wm = await one<Record<string, unknown>>(`
    SELECT
      SUM(${hasBytes("s.words", [WM.ifunc])}) AS words_any,
      SUM(${hasBytes("JSON_EXTRACT(s.words, '$[*].english')", [WM.ifunc])}) AS words_en,
      SUM(${hasBytes("JSON_EXTRACT(s.words, '$[*].chinese')", [WM.ifunc])}) AS words_zh,
      SUM(${hasBytes("JSON_EXTRACT(s.chunks, '$[*].text')", [WM.ifunc])}) AS chunks_text,
      SUM(${hasBytes("s.chinese", [WM.ifunc])}) AS sent_zh
    FROM sentences s ${REACH_JOIN}`)

  section("[B] 注入水印 / 打字目标污染")
  add(
    "英文 english 含水印（TTS 与完整句显示）",
    n(sentAll, "wm_english"),
    n(sentR, "wm_english"),
    "中",
    "仅影响显示与 TTS，不影响逐词打字",
    PS,
  )
  add(
    "中文 chinese 含水印（题目文本）",
    0,
    n(wm, "sent_zh"),
    "中",
    "不可见，通常无感",
    PS,
  )
  add(
    "逐词译文 words[].chinese 含水印",
    0,
    n(wm, "words_zh"),
    "低",
    "不可见；若译文本身只有水印会显示空白",
    PS_WORDS,
  )
  add(
    "打字目标 words[].english 含水印",
    0,
    n(wm, "words_en"),
    "必修",
    "逐词模式永远无法判对，用户不知道错在哪",
    PS_WORDS,
  )
  add(
    "打字目标 chunks[].text 含水印",
    0,
    n(wm, "chunks_text"),
    "必修",
    "分块模式永远无法判对",
    PS_CHUNKS,
  )
  add(
    "英文含其他不可见字符（零宽/BOM/软连字符）",
    n(sentAll, "other_invis"),
    n(sentR, "other_invis"),
    "低",
    undefined,
    PS,
  )

  // ── C. 排版字符 / 空白 ────────────────────────────────────────────────────
  section("[C] 排版字符与空白")
  add(
    "英文含弯引号/破折号/省略号（键盘打不出）",
    n(sentAll, "typo"),
    n(sentR, "typo"),
    "重要",
    "逐词模式下若落入 words 则用户照着敲必然判错",
    PS,
  )
  add(
    "英文含 NBSP 不间断空格",
    n(sentAll, "nbsp"),
    n(sentR, "nbsp"),
    "低",
    "空白字符，不进入 words 比对；影响排版与 TTS 缓存",
    PS,
  )
  add("英文首尾有空白", n(sentAll, "untrimmed"), n(sentR, "untrimmed"), "中", undefined, PS)
  add("英文含连续两个空格", n(sentAll, "double_space"), n(sentR, "double_space"), "低", undefined, PS)
  add("英文超过 200 字符（打字负担过重）", n(sentAll, "very_long"), n(sentR, "very_long"), "低", undefined, PS)
  add("英文少于 3 字符（可能是碎片）", n(sentAll, "very_short"), n(sentR, "very_short"), "低", undefined, PS)
  add(
    "缺少逐词释义 words（退化为自动切词）",
    n(sentAll, "no_words"),
    n(sentR, "no_words"),
    "低",
    "有 fallback，可降级运行",
    PS,
  )

  // ── D. 音标质量 ───────────────────────────────────────────────────────────
  // phonetic 期望是 string 或 {uk,us}；实测大量数据是字面量字符串
  // "[object Object]"，即写入时对对象做了 String()，前端会原样渲染出来。
  const phon = await one<Record<string, unknown>>(`
    SELECT
      SUM(${hasBytes("JSON_EXTRACT(s.words, '$[*].phonetic')", ["5B6F626A656374204F626A6563745D"])}) AS broken,
      SUM(${hasBytes("JSON_EXTRACT(s.words, '$[*].phonetic')", ["7B22"])}) AS as_object
    FROM sentences s ${REACH_JOIN}
    WHERE COALESCE(JSON_LENGTH(s.words), 0) > 0`)

  section("[D] 音标质量（句末结算页可见）")
  add(
    "phonetic 退化为字符串 \"[object Object]\"",
    0,
    n(phon, "broken"),
    "必修",
    "每句练完都会看到，直接暴露数据事故",
    PS_WORDS,
  )
  add(
    "phonetic 为 {uk,us} 对象（正常）",
    0,
    n(phon, "as_object"),
    undefined,
    "正常格式",
    PS_WORDS,
  )

  // ── E. 重复内容 ───────────────────────────────────────────────────────────
  const dup = await one<Record<string, unknown>>(`
    SELECT
      (SELECT COUNT(*) FROM (
        SELECT s.lesson_id, s.english FROM sentences s
        GROUP BY s.lesson_id, s.english HAVING COUNT(*) > 1) x) AS dup_in_lesson_all,
      (SELECT COUNT(*) FROM (
        SELECT s.lesson_id, s.english FROM sentences s ${REACH_JOIN}
        GROUP BY s.lesson_id, s.english HAVING COUNT(*) > 1) x) AS dup_in_lesson_reach,
      (SELECT COUNT(*) FROM (
        SELECT s.english FROM sentences s GROUP BY s.english HAVING COUNT(*) > 1) y) AS dup_groups_all,
      (SELECT COUNT(*) FROM (
        SELECT s.english FROM sentences s ${REACH_JOIN}
        GROUP BY s.english HAVING COUNT(*) > 1) y) AS dup_groups_reach,
      (SELECT COUNT(*) FROM sentences s ${REACH_JOIN}) AS total_reach,
      (SELECT COUNT(DISTINCT s.english) FROM sentences s ${REACH_JOIN}) AS distinct_reach`)

  const redundant = n(dup, "total_reach") - n(dup, "distinct_reach")

  section("[E] 重复内容")
  add(
    "同一课时内重复的句子（重复组数）",
    n(dup, "dup_in_lesson_all"),
    n(dup, "dup_in_lesson_reach"),
    "中",
    "用户会在同一课里重复练同一句",
  )
  add(
    "可达英文的跨句重复组数",
    n(dup, "dup_groups_all"),
    n(dup, "dup_groups_reach"),
    "低",
    undefined,
    n(dup, "distinct_reach"),
  )
  add(
    "可达内容冗余重复句子数（去重可省下的量）",
    0,
    redundant,
    "低",
    undefined,
    n(dup, "total_reach"),
  )

  // ── F. 元数据 ─────────────────────────────────────────────────────────────
  const meta = await one<Record<string, unknown>>(`
    SELECT
      (SELECT COUNT(*) FROM courses WHERE is_published = 1) AS pub,
      (SELECT COUNT(*) FROM courses WHERE is_published = 1
        AND (cover_url IS NULL OR TRIM(cover_url) = '')) AS no_cover,
      (SELECT COUNT(*) FROM courses WHERE is_published = 1
        AND (description IS NULL OR TRIM(description) = '')) AS no_desc,
      (SELECT COUNT(*) FROM courses WHERE is_published = 1
        AND (category_key IS NULL OR TRIM(category_key) = '')) AS no_category,
      (SELECT COUNT(*) FROM lessons l
        JOIN courses c ON c.id = l.course_id AND c.is_published = 1
        WHERE l.summary IS NULL OR TRIM(l.summary) = '') AS lesson_no_summary`)

  section("[F] 元数据")
  add(
    "已发布课程缺封面",
    n(meta, "no_cover"),
    n(meta, "no_cover"),
    "低",
    "课程列表观感",
    n(meta, "pub"),
  )
  add("已发布课程缺简介", n(meta, "no_desc"), n(meta, "no_desc"), "低", undefined, n(meta, "pub"))
  add(
    "已发布课程缺分类",
    n(meta, "no_category"),
    n(meta, "no_category"),
    "中",
    "影响课程列表筛选",
    n(meta, "pub"),
  )
  add(
    "已发布课时缺摘要",
    n(meta, "lesson_no_summary"),
    n(meta, "lesson_no_summary"),
    "低",
    undefined,
    PL,
  )

  // ── G. 排序稳定性 ─────────────────────────────────────────────────────────
  const order = await one<Record<string, unknown>>(`
    SELECT
      (SELECT COUNT(*) FROM (
        SELECT course_id, sort_order FROM lessons GROUP BY course_id, sort_order
        HAVING COUNT(*) > 1) a) AS lesson_collision,
      (SELECT COUNT(*) FROM (
        SELECT lesson_id, sort_order FROM sentences
        WHERE lesson_id IS NOT NULL GROUP BY lesson_id, sort_order
        HAVING COUNT(*) > 1) b) AS sentence_collision,
      (SELECT COUNT(*) FROM (
        SELECT lesson_id FROM sentences WHERE lesson_id IS NOT NULL
        GROUP BY lesson_id HAVING MIN(sort_order) = MAX(sort_order) AND COUNT(*) > 1) d) AS all_same_order`)
  section("[G] 排序稳定性")
  add("课时 sort_order 在同一课程内碰撞", n(order, "lesson_collision"), 0, "中", "列表顺序不稳定")
  add("句子 sort_order 在同一课时内碰撞", n(order, "sentence_collision"), 0, "低")
  add("整节课 sort_order 全相同（完全没有顺序）", n(order, "all_same_order"), 0, "中")

  // ── H. 功能依赖字段覆盖率 ─────────────────────────────────────────────────
  // 这一组不是"错误"，而是功能的地基：字段缺失时对应功能整体不可用。
  //
  // dependency_analysis 必须区分「非空」与「可用」：
  //   实测 174,876 行存的是 {"edges": [], "nodes": []} —— 分析跑过但没产出，
  //   是空壳而非 NULL。只看 IS NOT NULL 会得到 95% 的虚高覆盖率，
  //   实际能画出语法树的只有 57%。用 JSON_LENGTH($.nodes) > 0 才测得准。
  //   （这也是本项最初被漏掉的原因：临时 SQL 用了 IS NOT NULL。）
  const COV_SELECT = `
      COUNT(*) AS total,
      SUM(COALESCE(JSON_LENGTH(s.words), 0) > 0) AS words,
      SUM(JSON_CONTAINS_PATH(s.words, 'one', '$[*].definition') = 1) AS definition,
      SUM(COALESCE(JSON_LENGTH(s.chunks), 0) > 0) AS chunks,
      SUM(s.dependency_analysis IS NOT NULL) AS dep_present,
      SUM(s.dependency_analysis IS NOT NULL
          AND COALESCE(JSON_LENGTH(JSON_EXTRACT(s.dependency_analysis, '$.nodes')), 0) > 0) AS dep_usable,
      SUM(s.sentence_structure IS NOT NULL) AS struct_present,
      SUM(s.sentence_structure IS NOT NULL
          AND COALESCE(JSON_LENGTH(s.sentence_structure), 0) > 0) AS struct_usable`

  const covAll = await one<Record<string, unknown>>(`SELECT ${COV_SELECT} FROM sentences s`)
  const covR = await one<Record<string, unknown>>(`SELECT ${COV_SELECT} FROM sentences s ${REACH_JOIN}`)

  const COV_ALL = n(covAll, "total")
  const COV_REACH = n(covR, "total")
  // 「画不出树」和「是空壳」是两件事，分母不同，不能混：
  //   画不出树 = 所有可达句 - 可用句（把「压根没有分析记录」也算进去）
  //   是空壳   = 有分析记录 - 可用句（分析跑过但没产出，是回填任务的目标集合）
  // 早期版本把后者误算成「所有可达句 - 可用句」，把 NULL 也算成空壳，数值偏大。
  const depUnusableAll = COV_ALL - n(covAll, "dep_usable")
  const depUnusableReach = COV_REACH - n(covR, "dep_usable")
  const depHollowAll = n(covAll, "dep_present") - n(covAll, "dep_usable")
  const depHollowReach = n(covR, "dep_present") - n(covR, "dep_usable")

  section("[H] 功能依赖字段覆盖率（缺失 = 对应功能整体不可用）")
  add(
    "逐词 words（逐词模式与点词详情的基础）",
    n(covAll, "words"),
    n(covR, "words"),
    "低",
    "缺失时退化为自动切词；有 fallback，不阻断",
    COV_REACH,
  )
  add(
    "逐词释义 words[].definition（点词详情释义）",
    n(covAll, "definition"),
    n(covR, "definition"),
    "重要",
    "实测为 0：点词详情拿不到中文释义，该功能目前是空壳",
    COV_REACH,
  )
  add(
    "分块 chunks（分块模式；阶段 3 的 i+1 编排前置）",
    n(covAll, "chunks"),
    n(covR, "chunks"),
    "中",
    "覆盖率极低，D5/D6 难度编排在补数前无法落地",
    COV_REACH,
  )
  add(
    "依存分析 dependency_analysis 非空（虚高口径）",
    n(covAll, "dep_present"),
    n(covR, "dep_present"),
    undefined,
    "此口径把空壳算作有值，仅用于对照 —— 真实可用看下一行",
    COV_REACH,
  )
  add(
    "依存分析 dependency_analysis 可用（nodes 非空）",
    n(covAll, "dep_usable"),
    n(covR, "dep_usable"),
    "中",
    "语法树 Ctrl+2 只在这个口径下能画出东西",
    COV_REACH,
  )
  add(
    "画不出语法树（无分析记录，或记录为空壳）",
    depUnusableAll,
    depUnusableReach,
    "中",
    "Ctrl+2 在这些句子上只会显示空状态；不是报错，但功能等于没有",
    COV_REACH,
  )
  add(
    "其中有分析记录但内容为空壳（可回填修复）",
    depHollowAll,
    depHollowReach,
    "中",
    "分析跑过却没产出，是回填任务应该瞄准的集合",
    COV_REACH,
  )
  add(
    "句子成分 sentence_structure 非空",
    n(covAll, "struct_present"),
    n(covR, "struct_present"),
    "中",
    "C5 句子成分标注的数据基础",
    COV_REACH,
  )
  add(
    "句子成分 sentence_structure 可用（数组非空）",
    n(covAll, "struct_usable"),
    n(covR, "struct_usable"),
    "中",
    undefined,
    COV_REACH,
  )

  // ── 输出 ──────────────────────────────────────────────────────────────────
  console.log(
    `\n基线: 课程 ${fmt(n(base, "pc"))} 已发布 / ${fmt(n(base, "c"))} · ` +
      `课时 ${fmt(PL)} · 句子 ${fmt(PS)} 可达 / ${fmt(n(base, "s"))} 全库\n`,
  )

  for (const g of groups) {
    console.log(g.title)
    console.log(
      "  指标".padEnd(50) + "可达".padStart(10) + "占比".padStart(8) + "全库".padStart(12) + "  优先级",
    )
    console.log("  " + "─".repeat(94))
    for (const r of g.rows) {
      const share = r.denom && r.denom > 0 ? pct(r.reachable, r.denom) : "  -"
      console.log(
        "  " +
          r.label.padEnd(48) +
          fmt(r.reachable).padStart(10) +
          share.padStart(8) +
          fmt(r.all).padStart(12) +
          "  " +
          (r.mark ?? ""),
      )
      if (r.note) console.log("      " + r.note)
    }
    console.log()
  }

  console.log(`体检耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s（全程只读）`)

  if (WANT_JSON) {
    const out = path.join(ROOT, "content-audit.json")
    fs.writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), base, groups }, null, 2))
    console.log(`JSON 已写入 ${out}`)
  }

  await conn.end()
}

main().catch((e) => {
  console.error("体检失败:", (e as Error).message)
  process.exitCode = 1
})
