#!/usr/bin/env tsx
/**
 * 课程内容数据质量审计（只读：不调 LLM、不写库）。
 * Run: npx tsx scripts/quality-audit.ts [抽样数=3000]
 *
 * 范围：课本同步 + 课程同步。
 *  - 全量 SQL 轻量统计：中文含 CJK、英文长度、ai-expanded 数、课时内精确重复句
 *  - 随机抽样深检：words（音标/词性覆盖、词性白名单、缩写被标 VERB 的可疑模式）、
 *    chunks（拼接归一后==原句、片段中文齐全）、sentence_structure（下标合法、
 *    text 与分词表一致、角色白名单）
 *  - 末尾输出 8 句 ai-expanded 随机样本供人工目检
 */

import { config } from "dotenv"
config({ path: new URL("../.env.local", import.meta.url).pathname })

import mysql from "mysql2/promise"
import { dictationTokens } from "../src/lib/dictation-tokens"
import { normalizeSentenceForComparison } from "../src/lib/structured-answer"

const ROLE_SET = new Set([
  "主语", "谓语", "宾语", "表语", "定语", "状语", "补语", "宾语补足语", "同位语", "插入语", "形式主语",
])
// UD 词性 + 库里既有的中文词性口径（fragment-practice.ts:92 注释确认 words[].pos 本就是中文词性）
const POS_SET = new Set([
  "NOUN", "VERB", "ADJ", "ADV", "PRON", "DET", "AUX", "ADP", "PREP", "CCONJ", "SCONJ", "CONJ",
  "NUM", "INTJ", "PROPN", "PART", "PUNCT", "X",
  "代词", "动词", "名词", "形容词", "副词", "介词", "连词", "冠词", "数词", "感叹词", "标点", "助动词", "疑问词",
])

function jparse<T>(v: unknown): T | null {
  if (v == null) return null
  if (typeof v === "string") {
    try {
      return JSON.parse(v) as T
    } catch {
      return null
    }
  }
  return v as T
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9']/g, "")
}

async function main() {
  const SAMPLE = Number(process.argv[2] ?? 3000)
  const c = await mysql.createConnection(process.env.DATABASE_URL!)
  const scope = `co.deleted_at IS NULL AND (co.title LIKE '%课本同步%' OR co.title LIKE '%课程同步%')`

  const [liteRows] = await c.execute(`
    SELECT COUNT(*) total,
      SUM(chinese IS NULL OR chinese NOT REGEXP '[一-鿿]') no_cjk,
      SUM(CHAR_LENGTH(english) > 200) eng_long,
      SUM(s.tags LIKE '%ai-expanded%') ai_n
    FROM sentences s JOIN lessons l ON s.lesson_id = l.id JOIN courses co ON l.course_id = co.id
    WHERE ${scope}`)
  const [dupRows] = await c.execute(`
    SELECT COUNT(*) dup_groups, IFNULL(SUM(n-1),0) dup_extra FROM (
      SELECT s.lesson_id, LOWER(TRIM(s.english)) e, COUNT(*) n
      FROM sentences s JOIN lessons l ON s.lesson_id = l.id JOIN courses co ON l.course_id = co.id
      WHERE ${scope} GROUP BY s.lesson_id, LOWER(TRIM(s.english)) HAVING n > 1
    ) t`)
  const lite = (liteRows as any[])[0]
  const dup = (dupRows as any[])[0]
  console.log(`\n📊 全量统计（${lite.total} 句）`)
  console.log(`   中文缺 CJK: ${lite.no_cjk} | 英文>200字符: ${lite.eng_long} | ai-expanded: ${lite.ai_n}`)
  console.log(`   课时内精确重复: ${dup.dup_groups} 组（多余 ${dup.dup_extra} 句）`)

  const [rows] = await c.execute(`
    SELECT s.english, s.chinese, s.words, s.chunks, s.sentence_structure
    FROM sentences s JOIN lessons l ON s.lesson_id = l.id JOIN courses co ON l.course_id = co.id
    WHERE ${scope} ORDER BY RAND() LIMIT ${SAMPLE}`)

  let noWords = 0, phMissing = 0, phTotal = 0, posMissing = 0, posBad = 0
  const posBadSamples: string[] = []
  const posUnknown: Record<string, number> = {}
  let contractionVerb = 0
  let chunkNull = 0, chunkBad = 0, chunkZhEmpty = 0, chunkTotal = 0
  let chunkWholeBad = 0, chunkFragBad = 0, chunkOdd = 0
  let structNull = 0, structBad = 0, structTotal = 0
  const structReasons: Record<string, number> = {}
  const badRoleCounts: Record<string, number> = {}
  const structBadSamples: string[] = []
  let noCjk = 0

  for (const r of rows as any[]) {
    const english = String(r.english ?? "")
    const chinese = String(r.chinese ?? "")
    if (!/[一-鿿]/.test(chinese)) noCjk++
    const tokens = dictationTokens(english)

    const words = jparse<any[]>(r.words)
    if (!Array.isArray(words) || words.length === 0) noWords++
    else {
      for (const w of words) {
        const pos = String(w.pos ?? "").trim()
        if (!pos) posMissing++
        else if (!POS_SET.has(pos)) {
          posBad++
          if (posBadSamples.length < 5) posBadSamples.push(`${w.word ?? "?"}:${pos}`)
        }
        if (/[a-z]'[a-z]/i.test(String(w.word ?? "")) && pos === "VERB") contractionVerb++
        // 音标覆盖率只统计非标点 token（标点天然无音标）
        const wtext = String(w.word ?? w.english ?? "").trim()
        const isPunct = pos === "标点" || pos === "PUNCT" || (wtext !== "" && !/[a-zA-Z0-9]/.test(wtext))
        if (!isPunct) {
          phTotal++
          if (!String(w.phonetic ?? "").trim()) phMissing++
        }
      }
    }

    const chunks = jparse<any[]>(r.chunks)
    if (!Array.isArray(chunks) || chunks.length === 0) chunkNull++
    else {
      chunkTotal++
      const sentNorm = normalizeSentenceForComparison(english)
      // 写入侧契约（analyze-chunks.ts:160-161）：LLM 行 = base N 段 + 相邻合并 N-1 + 整句
      // 共 2N 项（偶数）；快路径行 = 仅整句 1 项。base（前 N 项）拼接必须还原原句。
      if (chunks.length === 1) {
        if (normalizeSentenceForComparison(String(chunks[0].text ?? "")) !== sentNorm) chunkBad++
      } else if (chunks.length % 2 === 0) {
        const n = chunks.length / 2
        const baseJoin = normalizeSentenceForComparison(chunks.slice(0, n).map((p) => String(p.text ?? "")).join(" "))
        if (baseJoin !== sentNorm) chunkBad++
        const tail = chunks.slice(n)
        if (normalizeSentenceForComparison(String(tail[tail.length - 1].text ?? "")) !== sentNorm) chunkWholeBad++
        if (tail.some((p) => {
          const t = normalizeSentenceForComparison(String(p.text ?? ""))
          return t === "" || !sentNorm.includes(t)
        })) chunkFragBad++
      } else {
        chunkOdd++
      }
      if (chunks.some((p) => !String(p.chinese ?? "").trim())) chunkZhEmpty++
    }

    const st = jparse<any[]>(r.sentence_structure)
    if (!Array.isArray(st) || st.length === 0) structNull++
    else {
      structTotal++
      let reason: string | null = null
      for (const comp of st) {
        const s0 = Number(comp.start)
        const e0 = Number(comp.end)
        if (!Number.isInteger(s0) || !Number.isInteger(e0) || s0 < 0 || e0 < s0 || e0 >= tokens.length) { reason = "下标非法"; break }
        const role = String(comp.role ?? "")
        if (!ROLE_SET.has(role)) { reason = "role"; badRoleCounts[role] = (badRoleCounts[role] ?? 0) + 1; break }
        const expected = tokens.slice(s0, e0 + 1).join(" ")
        if (norm(String(comp.text ?? "")) !== norm(expected)) { reason = "text不匹配"; break }
      }
      if (reason) {
        structBad++
        structReasons[reason] = (structReasons[reason] ?? 0) + 1
        if (structBadSamples.length < 3) structBadSamples.push(english.slice(0, 50))
      }
    }
  }

  const pct = (a: number, b: number) => (b === 0 ? "n/a" : ((a / b) * 100).toFixed(2) + "%")
  console.log(`\n🔍 深检抽样 ${rows.length} 句`)
  console.log(`   words: 缺words ${noWords} | 音标缺失(非标点) ${phMissing}/${phTotal} (${pct(phMissing, phTotal)}) | 词性缺失 ${posMissing} | 词性白名单外 ${posBad}`)
  console.log(`   白名单外明细: ${Object.entries(posUnknown).map(([k, v]) => `${k}×${v}`).join(" ") || "无"} | 样例 ${posBadSamples.join(" ")}`)
  console.log(`   缩写被标 VERB（可疑，如 I'm→VERB）: ${contractionVerb}`)
  console.log(`   chunks: 缺失 ${chunkNull} | base拼接不符 ${chunkBad}/${chunkTotal} (${pct(chunkBad, chunkTotal)}) | 尾部非整句 ${chunkWholeBad} | 片段不连续/空 ${chunkFragBad} | 奇数长度 ${chunkOdd} | 片段缺中文 ${chunkZhEmpty}`)
  console.log(`   structure: 缺失 ${structNull} | 校验不过 ${structBad}/${structTotal} (${pct(structBad, structTotal)}) | 原因 ${Object.entries(structReasons).map(([k, v]) => `${k}×${v}`).join(" ") || "无"}`)
  if (Object.keys(badRoleCounts).length) console.log(`   未知角色: ${Object.entries(badRoleCounts).map(([k, v]) => `${k}×${v}`).join(" ")}`)
  console.log(`   structure 样例: ${structBadSamples.join(" / ")}`)
  console.log(`   中文缺 CJK: ${noCjk}`)

  const [eyeball] = await c.execute(`
    SELECT s.english, s.chinese, s.chunks FROM sentences s
    JOIN lessons l ON s.lesson_id = l.id JOIN courses co ON l.course_id = co.id
    WHERE ${scope} AND s.tags LIKE '%ai-expanded%' ORDER BY RAND() LIMIT 8`)
  console.log(`\n👁 人工抽检样本（ai-expanded 随机 8 句）`)
  for (const r of eyeball as any[]) {
    console.log(`   • ${r.english}`)
    console.log(`     ${r.chinese}`)
    const chunks = jparse<any[]>(r.chunks)
    if (Array.isArray(chunks) && chunks.length) {
      const base = chunks.slice(0, 4).map((p) => `${p.text}(${p.chinese})`).join(" + ")
      console.log(`     切分: ${base}${chunks.length > 4 ? " …" : ""}`)
    }
  }
  await c.end()
}

main()
