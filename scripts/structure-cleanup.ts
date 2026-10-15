#!/usr/bin/env tsx
/**
 * sentence_structure 清理（只删坏行，不生成；生成交给 analyze-structures.ts 重扫）。
 * Run: npx tsx scripts/structure-cleanup.ts [--apply]
 *   默认 dry（只统计），--apply 才把坏行置 NULL。
 *
 * 校验口径镜像 src/lib/structured-answer.ts buildStructuredAnswer 的真实契约：
 *  - 所有成分 text 拼接归一化后必须等于原句归一化（app 在不一致且 enableFallback
 *    时会整句降级纯文本，失去高亮——这就是要清掉重扫的原因）
 *  - 容错祈使句「隐含主语 You」：首成分是 You 且去掉后拼接==原句 → 视为通过
 *    （structured-answer.ts:264-289 同款逻辑）
 *  - start/end 必须是合法下标且落在 dictationTokens(english) 范围内
 *    （数据词级高亮 data-word-start/end 依赖）
 *  - role 不做白名单校验：app 直接渲染 role 字符串，非标准标签只是展示层小噪音
 */

import { config } from "dotenv"
config({ path: new URL("../.env.local", import.meta.url).pathname })

import mysql from "mysql2/promise"
import { dictationTokens } from "../src/lib/dictation-tokens"
import { normalizeSentenceForComparison } from "../src/lib/structured-answer"

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

function joinText(parts: Array<{ text?: string }>): string {
  return parts.map((p) => String(p.text ?? "")).join(" ")
}

/** 镜像 buildStructuredAnswer：结构拼接与原句是否一致（含隐含主语 You 容错）。 */
function structureMatches(english: string, comps: Array<Record<string, unknown>>): boolean {
  const original = normalizeSentenceForComparison(english)
  let joined = normalizeSentenceForComparison(joinText(comps))
  if (joined === original) return true
  // 隐含主语 You 容错：首成分是 You/主语类 → 去掉再比
  const firstNonEmpty = comps.findIndex((f) => String(f.text ?? "").trim() !== "")
  if (firstNonEmpty >= 0) {
    const first = comps[firstNonEmpty]
    const firstText = normalizeSentenceForComparison(String(first.text ?? ""))
    const firstType = String(first.type ?? "").toLowerCase().trim()
    const firstRole = String(first.role ?? "")
    const isImplicitYou =
      firstText === "you" &&
      (firstType === "subject" || firstType === "pronoun" || firstType === "nsubj" || firstType === "" || firstRole === "主语")
    if (isImplicitYou && !original.startsWith("you ")) {
      const trimmed = comps.slice(firstNonEmpty + 1)
      if (normalizeSentenceForComparison(joinText(trimmed)) === original) return true
    }
  }
  void joined
  return false
}

async function main() {
  const APPLY = process.argv.includes("--apply")
  const c = await mysql.createConnection(process.env.DATABASE_URL!)
  const [rows] = await c.execute(`
    SELECT s.id, s.english, s.sentence_structure
    FROM sentences s
    JOIN lessons l ON s.lesson_id = l.id
    JOIN courses co ON l.course_id = co.id
    WHERE co.deleted_at IS NULL
      AND (co.title LIKE '%课本同步%' OR co.title LIKE '%课程同步%')
      AND s.sentence_structure IS NOT NULL`)

  const bad: string[] = []
  let checked = 0
  for (const r of rows as any[]) {
    checked++
    const english = String(r.english ?? "")
    const st = jparse<Array<Record<string, unknown>>>(r.sentence_structure)
    if (!Array.isArray(st) || st.length === 0) {
      bad.push(r.id)
      continue
    }
    let ok = structureMatches(english, st)
    if (ok) {
      const tokens = dictationTokens(english)
      for (const comp of st) {
        const s0 = Number(comp.start)
        const e0 = Number(comp.end)
        if (!Number.isInteger(s0) || !Number.isInteger(e0) || s0 < 0 || e0 < s0 || e0 >= tokens.length) {
          ok = false
          break
        }
        if (norm(String(comp.text ?? "")) !== norm(tokens.slice(s0, e0 + 1).join(" "))) {
          ok = false
          break
        }
      }
    }
    if (!ok) bad.push(r.id)
  }

  console.log(`检查 ${checked} 句，校验不过 ${bad.length} 句${APPLY ? " → 已置 NULL（重扫即重生成）" : "（dry，加 --apply 置 NULL）"}`)
  if (bad.length > 0 && bad.length <= 20) console.log(bad.join(", "))
  if (APPLY && bad.length > 0) {
    // 分批置 NULL，避免超长 IN 列表
    const BATCH = 500
    for (let i = 0; i < bad.length; i += BATCH) {
      const chunk = bad.slice(i, i + BATCH)
      await c.query(
        `UPDATE sentences SET sentence_structure = NULL WHERE id IN (${chunk.map(() => "?").join(",")})`,
        chunk,
      )
    }
    console.log(`已置 NULL ${bad.length} 句；重跑 analyze-structures.ts 两个范围即可重生成。`)
  }
  await c.end()
}

main()
