/**
 * 分段练习（fragment practice）的数据层 —— 把库里 `sentences.chunks` 裁成
 * 一串「可以按顺序逐段听写」的片段。
 *
 * 为什么不照抄参考站的 `parseAndSortFragments`（practice.js:2562-2611）：
 * 参考站的 `fragments` 是**线性互斥**分段 —— 数组里每一项都是句子的一截，
 * 按数组顺序拼起来正好等于原句，所以它直接用数组顺序。
 *
 * 我们的 `chunks` 是**层级累积**型：数组里同时含短片段、由短片段组合出的
 * 长片段、甚至整句本身，还常常不按顺序。实测 6000 条带 chunks 的句子：
 * **0%** 能按数组顺序拼回原句。照抄会让用户把整句听写七八遍
 * （样例：`Our relationships / with others / Our relationships with others /
 * the single most important factor / … / <整句>`）。
 *
 * 所以这里做一次「线性化」：把 chunks 当作**候选片段集合**，在原句词序列上
 * 用动态规划求一个**不重叠、恰好铺满、片段数最多**的组合。实测 6000 条：
 * 数组顺序贪心能线性化出 ≥2 段的占 52.8%，本 DP 实现占 **83.7%**。
 * 铺不满的（数据本身有缺口，如 `Do you remember Daddy's number?` 只标了
 * 宾语 `Daddy's number?`）返回 null，该句退化成整句听写 —— 与参考站
 * 「没有有效片段就跳过分段练习」的口径一致。
 *
 * 纯净模块：无 React、无 DOM、无 DB，可直接单测。
 */

import type { Chunk, Sentence, Word } from "@/types"
import { normalizeSentenceForComparison } from "@/lib/structured-answer"
import { PROPER_NAME_POS, cleanWordForNameLookup } from "@/lib/dictation-tokens"

/** 一个可以单独听写的片段。字段对应参考站 `parseAndSortFragments` 的产物。 */
export interface PracticeFragment {
  text: string
  /** 中文提示。参考站取 `item.zh || item.meaning || …`；我们库里是 `chinese`。 */
  meaning: string
  /**
   * 参考站 `parseAndSortFragments` **硬编码** `'chunk'`（practice.js:2589），
   * 不读数据里的成分字段。照抄。
   */
  component: string
}

/** 纯数字/标点片段（如日期、编号）不构成可练内容，参考站 practice.js:2601 会剔掉。 */
const PURE_NUMBER_FRAGMENT = /^[\d\s.,!?;:()\-—]+$/

/** 末尾所有格剥离，与参考站 practice.js:2632 的 `stripTokenPossessive` 逐字一致。 */
function stripTokenPossessive(token: string): string {
  return token.replace(/['`’]s$/i, "").replace(/s['`’]$/i, "s")
}

/** 归一化后切成词（用于铺满比对）。 */
function words(text: string): string[] {
  return normalizeSentenceForComparison(text).split(" ").filter(Boolean)
}

/**
 * 把 `chunks`（可能是数组，也可能是 JSON 字符串）解成候选片段。
 * 对应参考站 practice.js:2568-2589：字符串则 `JSON.parse`，非数组或空 → null，
 * 逐项取 text/meaning，text 为空则跳过。
 */
function parseCandidates(chunks: unknown): Array<PracticeFragment & { order: number }> {
  let raw: unknown = chunks
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw)
    } catch {
      return []
    }
  }
  if (!Array.isArray(raw) || raw.length === 0) return []

  return raw
    .map((item, index) => {
      const rec = (item ?? {}) as Record<string, unknown>
      // 参考站读 `en || text || Text`；我们的库字段是 `text`。
      const text = String(rec.text ?? rec.en ?? rec.Text ?? "").trim()
      // 参考站读 `zh || meaning || translation || Meaning`；我们的是 `chinese`。
      const meaning = String(
        rec.chinese ?? rec.zh ?? rec.meaning ?? rec.translation ?? rec.Meaning ?? "",
      ).trim()
      const order = typeof rec.order === "number" ? rec.order : Number(rec.order)
      return {
        text,
        meaning,
        component: "chunk",
        order: Number.isFinite(order) ? order : index,
      }
    })
    .filter((f) => f.text.length > 0)
}

/**
 * 去掉「整个片段都是人名」的候选（参考站 practice.js:2626-2651）。
 *
 * 我们目前**没有** NER 标注 —— `words[].pos` 存的是中文词性（「代词」「名词」），
 * 不是 `person_name`。所以传入的 `personNameTokens` 通常是空集，这个过滤是
 * 惰性的；实现保留是为了口径一致，等日后接上 NER 就自动生效。
 */
export function filterPersonNameOnlyFragments(
  fragments: PracticeFragment[],
  personNameTokens: ReadonlySet<string>,
): PracticeFragment[] {
  if (fragments.length === 0 || personNameTokens.size === 0) return fragments
  return fragments.filter((frag) => {
    const tokens = frag.text
      .toLowerCase()
      .replace(/[.,!?;:"()—\-]/g, " ")
      .split(/\s+/)
      .filter(Boolean)
    if (tokens.length === 0) return true
    return !tokens.every(
      (t) => personNameTokens.has(t) || personNameTokens.has(stripTokenPossessive(t)),
    )
  })
}

/**
 * 从 `sentence.words` 收集人名 token（当前数据下为空集，见上）。
 *
 * 逐字对齐参考站 `buildWordAnalysisMap`（practice.js:6158-6190）：
 * 先剥末尾所有格（`Jeremy Short's` → `Jeremy Short`）；**剥完仍含空格**的
 * 视为多词人名，把**每个 part** 分别登记（`jeremy`、`short`）；否则整体登记。
 * 参考站对 part 的去标点口径含连字符、**不含撇号**，见
 * `cleanWordForNameLookup`。
 */
export function personNameTokensFromWords(wordsData: Word[] | null | undefined): Set<string> {
  const set = new Set<string>()
  if (!Array.isArray(wordsData)) return set
  for (const w of wordsData) {
    const pos = (w?.pos ?? "").trim().toLowerCase()
    if (!(PROPER_NAME_POS as readonly string[]).includes(pos)) continue
    const rawWord = (w.english ?? "").trim()
    if (!rawWord) continue
    const cleanedRaw = stripTokenPossessive(rawWord)
    if (/\s/.test(cleanedRaw)) {
      for (const part of cleanedRaw.split(/\s+/).filter(Boolean)) {
        const key = cleanWordForNameLookup(part)
        if (key) set.add(key)
      }
    } else {
      const key = cleanWordForNameLookup(cleanedRaw)
      if (key) set.add(key)
    }
  }
  return set
}

/**
 * 过滤 + 兜底：参考站先做人名过滤、再剔纯数字片段，**过滤后为空则回退原始片段**
 * （practice.js:2596-2605）。照抄这个兜底，避免把有数据的句子清成没数据。
 */
function finalizeFragments(
  fragments: PracticeFragment[],
  personNameTokens: ReadonlySet<string>,
): PracticeFragment[] {
  const byName = filterPersonNameOnlyFragments(fragments, personNameTokens)
  const byNumber = byName.filter((f) => !PURE_NUMBER_FRAGMENT.test(f.text))
  return byNumber.length > 0 ? byNumber : fragments
}

/**
 * 把 chunks 线性化成可逐段听写的片段数组。
 *
 * @param chunks  `sentences.chunks`（数组或 JSON 字符串）
 * @param sentence 原句（`sentences.english`），铺满比对的目标
 * @param personNameTokens 人名 token 集（没有 NER 时传空集）
 * @returns 至少 2 个片段且恰好铺满原句时返回片段数组；否则返回 null
 *          （该句不做分段练习，直接整句听写）
 *
 * 边界与参考站一致：
 * - 解不出候选 / 原句为空 / 铺不满 → null
 * - 只能铺出 **1** 段 → null。参考站 practice.js:4464 的跳过条件是
 *   「单片段且去非词字符后等于原句」，而我们的片段必须铺满原句，
 *   所以 1 段必然等于整句，两个判据等价。
 */
export function linearizeChunks(
  chunks: unknown,
  sentence: string,
  personNameTokens: ReadonlySet<string> = new Set(),
): PracticeFragment[] | null {
  const candidates = parseCandidates(chunks)
  if (candidates.length === 0) return null

  const target = words(sentence)
  if (target.length === 0) return null

  // 参考站不读 order 字段、不排序，完全依赖数组顺序（已 grep 确认）。
  // 我们这里**按 order 升序**遍历，让同长度的候选里「序号更小者」优先 ——
  // 因为我们的数组是层级累积的，低 order 更接近原子片段。
  // DP 只在「严格更优」时替换，所以先遍历到的那条胜出。
  const ordered = candidates
    .map((c, index) => ({ c, index }))
    .sort((a, b) => (a.c.order !== b.c.order ? a.c.order - b.c.order : a.index - b.index))
    .map((x) => x.c)

  const segs = ordered.map((c) => words(c.text))
  const n = target.length

  // best[pos] = 恰好覆盖 target[0..pos) 所需的最多片段数；-1 表示不可达
  const best = new Array<number>(n + 1).fill(-1)
  const from = new Array<{ pos: number; seg: number } | null>(n + 1).fill(null)
  best[0] = 0

  for (let pos = 0; pos < n; pos++) {
    if (best[pos] < 0) continue
    for (let k = 0; k < ordered.length; k++) {
      const seg = segs[k]
      if (seg.length === 0) continue
      const end = pos + seg.length
      if (end > n) continue
      if (target.slice(pos, end).join(" ") !== seg.join(" ")) continue
      if (best[end] < best[pos] + 1) {
        best[end] = best[pos] + 1
        from[end] = { pos, seg: k }
      }
    }
  }

  if (best[n] < 0) return null

  const picked: PracticeFragment[] = []
  let cur = n
  while (cur > 0) {
    const step = from[cur]
    if (!step) return null
    picked.unshift(ordered[step.seg])
    cur = step.pos
  }

  if (picked.length <= 1) return null
  return finalizeFragments(picked, personNameTokens)
}

/** `Sentence` 上的便捷封装：一次拿到候选片段（含人名 token 收集）。 */
export function fragmentsForSentence(sentence: Sentence | null): PracticeFragment[] | null {
  if (!sentence) return null
  return linearizeChunks(
    sentence.chunks as Chunk[] | null | undefined,
    sentence.english ?? "",
    personNameTokensFromWords(sentence.words),
  )
}

/**
 * 从片段里挑「更适合配图」的核心词 —— 逐字移植参考站 `extractCoreWords`
 * （practice.js:2858-2900）。
 *
 * 规则：去标点小写切词；**单个词直接返回**；实义词超过 4 个返回 null；
 * 用虚词表过滤后取实义词；去重后**倒序**返回（英语里名词多在后面，
 * 优先拿名词配图：`water the plants` → `['plants','water']`）。
 *
 * 注意：我们仓库没有 `GET /api/searchWord/image` 接口，所以这个函数的产物
 * 目前只用于决定「是否渲染配图位」——而因为没有图源，界面**不渲染**该容器。
 * 保留完整实现是为了口径一致（参考站的 `fragment_image_enabled` 卡也还在）。
 */
export function extractCoreWords(text: string): string[] | null {
  if (!text) return null
  const clean = text.trim().replace(/[.,!?;:'"()—]/g, "").trim().toLowerCase()
  if (!clean) return null
  const list = clean.split(/\s+/).filter((w) => w.length > 0)
  if (list.length === 0) return null
  if (list.length === 1) return list

  const contentWords = list.filter((w) => !FRAGMENT_STOP_WORDS.has(w))
  if (contentWords.length === 0 || contentWords.length > 4) return null
  return [...new Set(contentWords)].reverse()
}

/** 参考站 practice.js:2874-2896 的虚词表，逐字照抄。 */
const FRAGMENT_STOP_WORDS = new Set([
  "a", "an", "the",
  "in", "on", "at", "to", "for", "of", "with", "by", "from", "up", "down",
  "into", "out", "about", "over", "under", "between", "through", "after",
  "before", "during", "without", "within", "along", "around", "across",
  "behind", "below", "above", "near", "off", "upon", "toward", "towards",
  "i", "me", "my", "mine", "you", "your", "yours",
  "he", "him", "his", "she", "her", "hers",
  "it", "its", "we", "us", "our", "ours",
  "they", "them", "their", "theirs",
  "this", "that", "these", "those",
  "myself", "yourself", "himself", "herself", "itself",
  "is", "am", "are", "was", "were", "be", "been", "being",
  "do", "does", "did", "will", "would", "shall", "should",
  "can", "could", "may", "might", "must",
  "have", "has", "had", "having",
  "and", "or", "but", "nor", "so", "yet",
  "not", "no", "very", "too", "also", "just", "then",
  "there", "here", "some", "any", "all", "each", "every",
])
