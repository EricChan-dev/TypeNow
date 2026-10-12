/**
 * 结构化答案视图（「看答案」浮层 + 复习屏的语法结构视图）。
 *
 * 参考站 `renderStructuredAnswer()`（practice.js:5525-5710）把句子按成分切成
 * 一串 `<span class="answer-component component-<type>">`，每块里再嵌
 * `.component-label`（「主语」）/`.component-text`（内部是 `.clickable-word`）/
 * `.component-phonetics`（音标）/`.component-meaning`（成分释义）；没有成分
 * 标签的块降级成 `.answer-component-plain`。外层容器：hint 浮层用
 * `.structured-answer`，复习屏用 `.structure-view-wrapper`。
 *
 * 这里把同一套逻辑抽成**纯函数返回数据**，由 React 渲染（不拼 HTML 字符串 ——
 * 句子来自用户可编辑的题库，拼串就得自己负责转义）。CSS 类名与嵌套结构
 * 逐字对齐参考站，所以移植过来的样式表能直接生效。
 *
 * ## 与参考站的唯一实质差异：成分的单词下标来自数据库
 *
 * 参考站只有 fragment 的文本，所以它**顺序累加**每个 fragment 的单词数来
 * 现算 `data-word-start/end`。我们库里的 `sentence_structure[].start/end`
 * 本来就是权威下标（而且已实测与 `dictationTokens()` 的切法完全一致）。
 *
 * 这不是可有可无的替换：我们的结构数据**允许有缺口**，顺序累加会算错。
 * 实测 `They are often used to decorate windows and doors during festivals`
 * 的成分是 `They[0-0] / often[2-2] / to decorate…[4-8] / during…[9-10]`
 * —— 下标 1（are）与 3（used）没有任何成分覆盖。顺序累加会把 often 算成
 * 1、把 to decorate… 算成 2..5，于是**聚焦时高亮的成分全都是错的**。
 * 用 `start/end` 才能让「聚焦第 N 格 → 高亮第 N 格所属成分」成立。
 */
import type { Sentence, SentenceComponent, Word } from "@/types"
import type { Accent } from "@/lib/annotated-sentence"
import { extractPhonetic } from "@/lib/annotated-sentence"
import { normalizeQuotes } from "@/lib/dictation-tokens"

/** `.component-text` 里的一小段：可能可点（`query` 非空），也可能是标点/空白。 */
export interface ClickableToken {
  text: string
  /** 查词键（原形，小写）；null 表示这段不可点。 */
  query: string | null
}

/** 一个句子成分块。 */
export interface StructuredPart {
  /** 成分原文（保留原始大小写与标点）。 */
  text: string
  /** 英文成分类型，小写（subject/predicate/…）；空串表示数据里没有。 */
  componentType: string
  /** 中文标签（主语/谓语/…）。**空串表示走 `.answer-component-plain` 分支。** */
  label: string
  /** 成分释义（`.component-meaning`）；空串则整个 span 不渲染。 */
  meaning: string
  /**
   * `data-word-start` / `data-word-end`。`null` 表示**禁用高亮** ——
   * 参考站在「存在以撇号开头的 fragment」时整句都不输出这两个属性
   * （缩写的切法与输入框不兼容，高亮会错位）。
   */
  wordStart: number | null
  wordEnd: number | null
  /** 缩写后半截（`'s` / `'re`），CSS 用它拉近与前词的间距。 */
  contractionSuffix: boolean
  tokens: ClickableToken[]
  /** 该成分每个词的音标（查不到的词不占位）。 */
  phonetics: string[]
  /** 句末标点（只挂在最后一个非空成分上）；空串表示不补。 */
  trailingPunctuation: string
  /**
   * 缩写后缀且查不到音标时，插一个 `visibility:hidden` 的占位 span，
   * 让它的中文释义与相邻成分对齐（参考站原样行为）。
   */
  phoneticsPlaceholder: boolean
}

export interface StructuredAnswer {
  /** false 表示数据缺失/不一致降级 —— 调用方应渲染 `.answer-text-plain`。 */
  structured: boolean
  plainText: string
  parts: StructuredPart[]
}

// ─── 纯文本工具（practice.js:5457-5488） ────────────────────────────────────

/**
 * 归一化用于比对的句子：小写、弯引号转直引号、只留字母数字空格撇号。
 * 标点/空格差异都会被抹平（`practice.js:5457`）。
 */
export function normalizeSentenceForComparison(text: string | null | undefined): string {
  if (!text) return ""
  return normalizeQuotes(text)
    .toLowerCase()
    .replace(/[^a-z0-9'\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

/** 把 fragments 还原成一句话用于比对；以撇号开头的片段与前词直接拼接。 */
export function buildFragmentsTextForComparison(
  fragments: Array<{ text?: string | null }> | null | undefined,
): string {
  if (!Array.isArray(fragments) || fragments.length === 0) return ""
  let merged = ""
  for (const f of fragments) {
    const fragmentText = (f.text ?? "").trim()
    if (!fragmentText) continue
    if (/^['\u2018\u2019]/.test(fragmentText)) {
      merged += fragmentText
      continue
    }
    merged += (merged ? " " : "") + fragmentText
  }
  return merged
}

/** 提取句末标点（含结尾引号/括号）。`practice.js:5474`。 */
export function extractSentenceTerminalPunctuation(text: string | null | undefined): string {
  if (!text) return ""
  const match = text.trim().match(/([.!?。！？]+["'”’）)\]]*)$/)
  return match ? match[1] : ""
}

/** 文本是否已自带句末标点。`practice.js:5486`。 */
export function hasSentenceTerminalPunctuation(text: string | null | undefined): boolean {
  if (!text) return false
  return /[.!?。！？]["'”’）)\]]*$/.test(text.trim())
}

// ─── 可点击单词（practice.js:5405 makeTextClickable） ───────────────────────

const WORD_RE = /([a-zA-Z]+(?:'[a-zA-Z]+)?)/g

/** 缩写取原形：`don't`→`do`、`Farmer's`→`farmer`。 */
function queryFor(lower: string): string {
  if (lower.endsWith("n't")) return lower.slice(0, -3)
  if (lower.includes("'")) return lower.split("'")[0]
  return lower
}

/**
 * 把一个成分的文本切成「可点/不可点」的小段。
 *
 * 参考站对**不含空格**的文本走特殊分支（整段当一个词处理，避免正则把
 * `trees` 之类切错），含空格的才走 `[a-zA-Z]+(?:'[a-zA-Z]+)?` 正则。
 * 两个分支对单字母词的处理不一致（特殊分支不过滤长度），照抄。
 */
export function clickableTokens(text: string): ClickableToken[] {
  if (!text) return []
  const trimmed = text.trim()
  if (!trimmed.includes(" ")) {
    const cleanText = trimmed.replace(/^[.,!?;:"()—]+|[.,!?;:"()—]+$/g, "")
    if (cleanText.length > 0 && /[a-zA-Z]/.test(cleanText)) {
      const at = trimmed.indexOf(cleanText)
      const out: ClickableToken[] = []
      if (at > 0) out.push({ text: trimmed.slice(0, at), query: null })
      out.push({ text: cleanText, query: queryFor(cleanText.toLowerCase()) })
      const tail = at + cleanText.length
      if (tail < trimmed.length) out.push({ text: trimmed.slice(tail), query: null })
      return out
    }
  }

  const out: ClickableToken[] = []
  let last = 0
  WORD_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = WORD_RE.exec(text)) !== null) {
    const match = m[1]
    if (m.index > last) out.push({ text: text.slice(last, m.index), query: null })
    const lower = match.toLowerCase()
    // 单字母不查词，a / i 除外
    if (match.length < 2 && lower !== "a" && lower !== "i") {
      out.push({ text: match, query: null })
    } else {
      out.push({ text: match, query: queryFor(lower) })
    }
    last = m.index + match.length
  }
  if (last < text.length) out.push({ text: text.slice(last), query: null })
  // 整段没有任何词时仍保留原文，避免渲染成空
  if (out.length === 0) out.push({ text, query: null })
  return out
}

// ─── 音标（practice.js:buildPhoneticMap / getPhoneticForWord） ──────────────

/**
 * 词 → 音标队列。同一个词出现多次时按**出现顺序**逐条消费
 * （参考站用 `shift()`，`practice.js:887`）。
 */
function buildPhoneticQueues(
  words: Word[] | null | undefined,
  accent: Accent,
): Map<string, string[]> | null {
  if (!Array.isArray(words) || words.length === 0) return null
  const map = new Map<string, string[]>()
  for (const w of words) {
    const word = normalizeQuotes(w.english ?? "").toLowerCase().trim()
    if (!word) continue
    const list = map.get(word)
    if (list) list.push(extractPhonetic(w.phonetic, accent))
    else map.set(word, [extractPhonetic(w.phonetic, accent)])
  }
  return map.size > 0 ? map : null
}

const CONTRACTION_SUFFIXES = ["'s", "'re", "'ve", "'ll", "'d", "'t", "'m"]

/** 取一个词的音标，带缩写回溯与短语拆分。`practice.js:873-904`。 */
function phoneticForWord(map: Map<string, string[]> | null, word: string): string {
  if (!map) return ""
  const cleaned = normalizeQuotes(word).replace(/[.,!?;:"()—\-]/g, "").trim()
  if (!cleaned) return ""
  // 缩写后缀（'s / 're …）跳过：音标已由基词查找消费
  if (/^['\u2018\u2019][a-z]*$/i.test(cleaned)) return ""

  const key = cleaned.toLowerCase()
  const entries = map.get(key)
  if (entries && entries.length > 0) return entries.shift() ?? ""

  // 整体匹配失败 → 缩写回溯（what → what's / what're …）
  for (const suffix of CONTRACTION_SUFFIXES) {
    const cEntries = map.get(key + suffix)
    if (cEntries && cEntries.length > 0) return cEntries.shift() ?? ""
  }

  // 仍失败 → 拆成多个词逐个匹配（短语场景）
  const parts = cleaned.split(/\s+/).filter((w) => w.length > 0)
  if (parts.length <= 1) return ""
  const got: string[] = []
  for (const w of parts) {
    const p = phoneticForWord(map, w)
    if (p) got.push(p)
  }
  return got.join(" ")
}

// ─── 主入口 ────────────────────────────────────────────────────────────────

/** 数据缺失/不一致时的降级结果（`.answer-text-plain`）。 */
function plainAnswer(text: string): StructuredAnswer {
  return { structured: false, plainText: text, parts: [] }
}

/**
 * 构造结构化答案。
 *
 * @param sentence      句子（读 `english` 与 `sentenceStructure`）
 * @param accent        音标口音（参考站 `selectedAccentType`，默认美音）
 * @param enableFallback 结构与原句不一致时是否降级为纯文本。
 *   参考站**故意**分两种口径：练习中「看答案」传 `true`（宁可给纯文本也
 *   不能给错的标注），复习/学习界面传 `false`（即使不一致也照渲结构）。
 */
export function buildStructuredAnswer(
  sentence: Sentence | null | undefined,
  accent: Accent = "us",
  enableFallback = false,
): StructuredAnswer {
  const fallbackText = sentence?.english ?? ""
  const raw = sentence?.sentenceStructure
  if (!raw || !Array.isArray(raw) || raw.length === 0) return plainAnswer(fallbackText)

  try {
    let fragments: SentenceComponent[] = raw
    let fragmentsText = buildFragmentsTextForComparison(fragments)
    const originalNormalized = normalizeSentenceForComparison(fallbackText)
    let fragmentsNormalized = normalizeSentenceForComparison(fragmentsText)

    // 容错：结构与原句不一致时，先试「结构在句首多补了一个隐含主语 You」
    // （祈使句常见），去掉它再比一次（practice.js:5545-5582）。
    if (
      originalNormalized &&
      fragmentsNormalized &&
      originalNormalized !== fragmentsNormalized
    ) {
      const firstNonEmpty = fragments.findIndex((f) => (f.text ?? "").trim() !== "")
      if (firstNonEmpty >= 0) {
        const first = fragments[firstNonEmpty]
        const firstText = normalizeSentenceForComparison(first.text)
        const firstType = (first.type ?? "").toLowerCase().trim()
        const isImplicitYou =
          firstText === "you" &&
          (firstType === "subject" || firstType === "pronoun" || firstType === "nsubj" || firstType === "")
        if (isImplicitYou && !originalNormalized.startsWith("you ")) {
          const trimmed = fragments.slice(firstNonEmpty + 1)
          const trimmedText = buildFragmentsTextForComparison(trimmed)
          if (normalizeSentenceForComparison(trimmedText) === originalNormalized) {
            fragments = trimmed
            fragmentsText = trimmedText
            fragmentsNormalized = normalizeSentenceForComparison(trimmedText)
          }
        }
      }
    }

    if (
      originalNormalized &&
      fragmentsNormalized &&
      originalNormalized !== fragmentsNormalized &&
      enableFallback
    ) {
      return plainAnswer(fallbackText)
    }

    // 存在以撇号开头的成分 → 分段切法与输入框不兼容，整句禁用高亮属性。
    const hasContractionSplit = fragments.some((f) => /^['\u2018\u2019]/.test((f.text ?? "").trim()))

    const terminalPunctuation = extractSentenceTerminalPunctuation(fallbackText)
    const shouldAppendTerminalPunctuation =
      terminalPunctuation !== "" && !hasSentenceTerminalPunctuation(fragmentsText)

    let lastNonEmptyIndex = -1
    for (let i = fragments.length - 1; i >= 0; i--) {
      if ((fragments[i].text ?? "").trim()) {
        lastNonEmptyIndex = i
        break
      }
    }

    const phoneticMap = buildPhoneticQueues(sentence?.words, accent)

    const parts: StructuredPart[] = []
    fragments.forEach((f, index) => {
      const text = f.text ?? ""
      if (!text.trim()) return

      const componentType = (f.type ?? "").trim().toLowerCase()
      const meaning = (f.explanation ?? "").trim()
      // 中文标签直接用库里的 role（已是「主语/谓语/…」）。
      // 参考站要靠一张 type→中文 的映射表是因为它的数据只有英文 type；
      // 我们的 role 更权威（比如它认识 predicative=表语，而参考站的表里没有）。
      const label = (f.role ?? "").trim() || componentType

      const trimmedText = text.trim()
      const contractionSuffix = /^['\u2018\u2019]/.test(trimmedText)

      const wordStart = hasContractionSplit ? null : (f.start ?? 0)
      const wordEnd = hasContractionSplit ? null : Math.max(f.start ?? 0, f.end ?? f.start ?? 0)

      // 逐个词的音标（按顺序消费，与输入框/参考站一致）
      const componentWords = trimmedText.split(/\s+/).filter((w) => w.length > 0)
      const phonetics = componentWords
        .map((w) => phoneticForWord(phoneticMap, w))
        .filter((p) => p !== "")

      parts.push({
        text,
        componentType,
        label,
        meaning,
        wordStart,
        wordEnd,
        contractionSuffix,
        tokens: clickableTokens(text),
        phonetics,
        trailingPunctuation:
          index === lastNonEmptyIndex && shouldAppendTerminalPunctuation ? terminalPunctuation : "",
        phoneticsPlaceholder: contractionSuffix && phonetics.length === 0,
      })
    })

    return { structured: true, plainText: fallbackText, parts }
  } catch {
    return plainAnswer(fallbackText)
  }
}
