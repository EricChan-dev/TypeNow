/**
 * 词典数据的展示处理：音标格式与词性分组。
 *
 * 两件事都是"上游数据没错、展示方式错了"：
 *
 *   1. **音标**：句子里存的 phonetic 大多是 `{uk, us}` 对象、**不带斜杠**
 *      （生产库实测），而 IPA 的惯例是写在斜杠里（/ˈtəˈmɒrəʊ/）。
 *      词典接口返回的那份倒是自带斜杠，所以这个函数必须**幂等**。
 *
 *   2. **词性**：上游的 partOfSpeech 是英文单词（noun / adverb / pronoun…），
 *      definition 是**英文句子**（"On the day after the present day."）。
 *      而悬浮卡原来把最多 5 条 (词性, 释义) 平铺出来，其中同一个词性重复好几遍 ——
 *      看起来就像"一个单词有那么多词性"，而且中英混排对不上。
 *      这里按词性分组、每种词性最多留几条释义，让对应关系一眼可见。
 */

import { posLabel } from "@/lib/pos-labels"

/**
 * 把音标包进 `/ /`（IPA 惯例）。
 *
 * 幂等：已经带斜杠的（词典接口返回的那份是 `/təˈmɒrəʊ/`）原样返回，
 * 不会变成 `//x//`。方括号是另一套惯例（严式音标），同样不重复包裹。
 * 空值返回空串，由调用方决定要不要占位。
 */
export function wrapPhonetic(raw: string | null | undefined): string {
  const t = (raw ?? "").trim()
  if (!t) return ""
  if (t.startsWith("/") && t.endsWith("/")) return t
  if (t.startsWith("[") && t.endsWith("]")) return t
  // 有起无收（或反之）的脏数据：当作缺斜杠处理，包起来比原样露出更整齐
  return `/${t}/`
}

export interface DictSense {
  /** 上游的英文词性，如 "noun" / "adverb" / "pronoun" */
  pos: string
  /** 上游的英文释义（一句话） */
  meaning: string
}

export interface PosGroup {
  /** 原始英文词性 */
  pos: string
  /** 中文词性；上游给了词性但没登记中文时回落成原文 */
  label: string
  /** 该词性下的英文释义（已去重、已截断） */
  meanings: string[]
}

/**
 * 按词性把 (词性, 释义) 平铺列表分组。
 *
 * 为什么要分组：上游一个词常有 2 个词性、每个词性下好几个义项，
 * 平铺 + slice 的结果是"同一词性重复出现"，读起来像有很多词性。
 * 分组后每个词性只出现一次，中文标签在前、英文释义在后，对应关系清楚。
 *
 * maxPerPos 默认 2：再多就不是"这个词是什么意思"而是词条全文了。
 * 保持**首次出现顺序**（上游按常用度排），不要重排。
 */
export function groupSensesByPos(rows: DictSense[], maxPerPos = 2): PosGroup[] {
  const order: string[] = []
  const byPos = new Map<string, string[]>()

  for (const row of rows) {
    const rawPos = (row.pos ?? "").trim()
    const meaning = (row.meaning ?? "").trim()
    if (!meaning) continue
    // 没有词性的条目归到 ""，展示时用"释义"兜底，而不是丢弃它
    const key = rawPos
    if (!byPos.has(key)) {
      byPos.set(key, [])
      order.push(key)
    }
    const list = byPos.get(key)!
    if (!list.includes(meaning)) list.push(meaning)
  }

  return order
    .map((pos) => ({
      pos,
      label: pos ? posLabel(pos) : "释义",
      meanings: (byPos.get(pos) ?? []).slice(0, maxPerPos),
    }))
    // 全空的组（理论上不会出现，防御）不要留一个空壳
    .filter((g) => g.meanings.length > 0)
}

/** 一个单词的全部中文词性（去重），用于"词性：名词 / 动词"这类一行式展示。 */
export function distinctPosLabels(rows: DictSense[]): string[] {
  const out: string[] = []
  for (const row of rows) {
    const pos = (row.pos ?? "").trim()
    if (!pos) continue
    const label = posLabel(pos)
    if (!out.includes(label)) out.push(label)
  }
  return out
}
