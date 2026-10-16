/**
 * 听写模式「答案回顾屏」里那条带注释的句子。
 *
 * 这里把「分段 + 注音 + 词性着色」的逻辑
 * 抽成纯函数，返回结构化数据由 React 渲染（不拼 HTML 字符串 —— 句子来自用户
 * 可编辑的题库，拼串就得自己负责转义，交给 JSX 更安全）。
 *
 * 音标直接取自已对齐好的 `words[]`（`alignWordsWithEnglish` 保证 token 与 `words` 一一
 * 对应），不需要再对整句做短语搜索 —— 那样反而会把顺序错乱的脏数据
 * 匹配到别的词上。
 */
import type { Sentence, Word } from "@/types"
import { PUNCT_SENTINEL, WORD_SENTINEL } from "@/lib/word-align"

/** 音标口音。默认优先美音。 */
export type Accent = "us" | "uk"

// ─── 词性 ────────────────────────────────────────────────────────────────────

/** 各种缩写 → 标准词性。 */
const POS_ALIAS_MAP: Record<string, string> = {
  "n.": "noun",
  "noun.": "noun",
  "v.": "verb",
  "vt.": "verb",
  "vi.": "verb",
  "aux.v": "auxiliary verb",
  "auxiliary v.": "auxiliary verb",
  "modal v.": "modal verb",
  "modal v": "modal verb",
  "phr.v": "phrasal verb",
  "phrasal v.": "phrasal verb",
  "adj.": "adjective",
  "adv.": "adverb",
  "adv.phr": "adverb phrase",
  "adj.phr": "adjective phrase",
  "v.phr": "verb phrase",
  "adv-phrase": "adverb phrase",
  "adj-phrase": "adjective phrase",
  "v-phrase": "verb phrase",
  "adv phrase": "adverb phrase",
  "adj phrase": "adjective phrase",
  "v phrase": "verb phrase",
  "n phrase": "noun phrase",
  "n-phrase": "noun phrase",
  "n.possessive": "possessive noun",
  "n-possessive": "possessive noun",
  "n possessive": "possessive noun",
  "possessive noun": "possessive noun",
  "phr.": "phrase",
  "pron.": "pronoun",
  "prep.": "preposition",
  "conj.": "conjunction",
  "art.": "article",
  "det.": "determiner",
  "num.": "numeral",
  "interj.": "interjection",
  "int.": "interjection",
  "abbr.": "abbreviation",
  n: "noun",
  v: "verb",
  vt: "verb",
  vi: "verb",
  adj: "adjective",
  adv: "adverb",
  pron: "pronoun",
  prep: "preposition",
  conj: "conjunction",
  art: "article",
  det: "determiner",
  num: "numeral",
  interj: "interjection",
  int: "interjection",
  phr: "phrase",
  modal: "modal verb",
  aux: "auxiliary verb",
  person_name: "person name",
  name: "person name",
  gerund: "gerund",
  participle: "participle",
  infinitive: "infinitive",
  "present participle": "present participle",
  "past participle": "past participle",
  "v-ing": "gerund",
  "v.ing": "gerund",
  "n/v-ing": "gerund",
  "n/v.ing": "gerund",
  "adj/adv": "adjective",
  "v-ed/adj": "adjective",
  "v.ed/adj": "adjective",
  "adj/v-ed": "adjective",

  // ── Universal Dependencies 缩写（线上 words[].pos 的真实取值） ──
  //
  // 除词典体例缩写（n./adj./aux.v…）外，我们的语料是 spaCy 跑出来的 UD 标签
  // （生产库分布：NOUN/VERB/PRON/DET/ADP/AUX/ADV/PART/CCONJ/SCONJ/
  // PROPN_PERSON/NUM/INTJ/PROPN/SYM/X/PUNCT）。不登记这些，复习屏就会
  // 把 `ADP` 原样渲成 "adp"、`PROPN_PERSON` 渲成 "propn_person"。
  adp: "preposition",
  part: "particle",
  cconj: "coordinating conjunction",
  sconj: "subordinating conjunction",
  intj: "interjection",
  propn: "proper noun",
  propn_person: "person name",
  propn_loc: "proper noun",
  propn_org: "proper noun",
  sym: "symbol",
  punct: "punctuation",
  x: "other",
}

/** 英文词性 → 中文全称。 */
const POS_LABELS: Record<string, string> = {
  noun: "名词",
  verb: "动词",
  adjective: "形容词",
  adverb: "副词",
  pronoun: "代词",
  preposition: "介词",
  conjunction: "连词",
  interjection: "感叹词",
  determiner: "限定词",
  article: "冠词",
  "personal pronoun": "人称代词",
  "possessive pronoun": "物主代词",
  "reflexive pronoun": "反身代词",
  "demonstrative pronoun": "指示代词",
  "interrogative pronoun": "疑问代词",
  "relative pronoun": "关系代词",
  "indefinite pronoun": "不定代词",
  "auxiliary verb": "助动词",
  "modal verb": "情态动词",
  "linking verb": "系动词",
  "transitive verb": "及物动词",
  "intransitive verb": "不及物动词",
  "phrasal verb": "短语动词",
  infinitive: "不定式",
  gerund: "动名词",
  participle: "分词",
  "present participle": "现在分词",
  "past participle": "过去分词",
  "proper noun": "专有名词",
  "common noun": "普通名词",
  "collective noun": "集合名词",
  "abstract noun": "抽象名词",
  "countable noun": "可数名词",
  "uncountable noun": "不可数名词",
  "possessive noun": "名词所有格",
  "comparative adjective": "比较级形容词",
  "superlative adjective": "最高级形容词",
  "possessive adjective": "物主形容词",
  "demonstrative adjective": "指示形容词",
  "adverb of manner": "方式副词",
  "adverb of time": "时间副词",
  "adverb of place": "地点副词",
  "adverb of frequency": "频率副词",
  "adverb of degree": "程度副词",
  "coordinating conjunction": "并列连词",
  "subordinating conjunction": "从属连词",
  "noun phrase": "名词短语",
  "verb phrase": "动词短语",
  "adjective phrase": "形容词短语",
  "adverb phrase": "副词短语",
  "prepositional phrase": "介词短语",
  "infinitive phrase": "不定式短语",
  "gerund phrase": "动名词短语",
  "participial phrase": "分词短语",
  numeral: "数词",
  particle: "小品词",
  quantifier: "量词",
  exclamation: "感叹词",
  clause: "从句",
  subject: "主语",
  object: "宾语",
  complement: "补语",
  modifier: "修饰语",
  attributive: "定语",
  adverbial: "状语",
  appositive: "同位语",
  "adjective clause": "定语从句",
  "relative clause": "关系从句",
  "adverbial clause": "状语从句",
  "noun clause": "名词性从句",
  "object clause": "宾语从句",
  "subject clause": "主语从句",
  "predicative clause": "表语从句",
  "appositive clause": "同位语从句",
  "person name": "人名",
  symbol: "符号",
  punctuation: "标点",
  other: "其他",
}

/** 词性启发式兜底用的固定词表。 */
const MODAL_VERBS = new Set(["can", "could", "would", "should", "might", "may", "must", "shall", "will"])
const PRONOUNS = new Set(["i", "me", "you", "he", "him", "she", "her", "it", "we", "us", "they", "them", "who", "whom", "whose", "someone", "everyone", "anyone", "something", "nothing", "this", "that", "these", "those"])
const ARTICLES = new Set(["a", "an", "the"])
const CONJUNCTIONS = new Set(["and", "or", "but", "so", "because", "if", "while", "when", "after", "before", "as", "though", "although", "since", "unless"])
const PREPOSITIONS = new Set(["in", "on", "at", "to", "for", "from", "with", "without", "about", "into", "onto", "over", "under", "between", "among", "through", "across", "around", "during", "until", "till", "besides", "beyond", "within"])

/** 规范化词性。查不到时回退为小写原文。 */
export function normalizePos(pos: string | null | undefined): string {
  if (!pos) return ""
  const raw = pos.trim()
  if (!raw) return ""
  const lower = raw.toLowerCase()
  if (POS_ALIAS_MAP[lower]) return POS_ALIAS_MAP[lower]
  const simplified = lower.replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim()
  if (POS_ALIAS_MAP[simplified]) return POS_ALIAS_MAP[simplified]
  return lower
}

/**
 * 词性中文全称。
 *
 * `词` 是 `word-align.ts` 给「是词但词性未知」打的**内部哨兵**，不是词性：
 * `alignWordsWithEnglish` 用它把 token 分成「可输入的词」和「不可输入的标点」。
 * 词性缺失时输出**空**标签（`if (assignedPos)` 守卫），所以哨兵绝不能
 * 出现在界面上 —— 线上实测
 * `analyze` 这类无词性数据的句子会渲染成一个孤零零的「词」字。
 */
export function posLabel(pos: string | null | undefined): string {
  if (!pos) return ""
  const raw = pos.trim()
  if (!raw || raw === WORD_SENTINEL || raw === PUNCT_SENTINEL) return ""
  const normalized = normalizePos(raw)
  return POS_LABELS[normalized] || normalized
}

/**
 * 词性缺失时的启发式推断。
 *
 * `words[].pos` 拿不到词性时，用一组固定词表 + 后缀规则兜底，
 * 让 `the` / `and` / `in` 这类高频功能词至少有正确的颜色和标签。
 * 顺序有语义：情态动词必须在 `be` 之前，代词/冠词/连词/介词依次短路。
 */
export function inferPos(word: string | null | undefined): string {
  const w = (word ?? "").trim().toLowerCase().replace(/[^a-z']/g, "")
  if (!w) return ""
  if (MODAL_VERBS.has(w) || w === "be") return "verb"
  if (PRONOUNS.has(w)) return "pronoun"
  if (ARTICLES.has(w)) return "article"
  if (CONJUNCTIONS.has(w)) return "conjunction"
  if (PREPOSITIONS.has(w)) return "preposition"
  if (w.endsWith("ly")) return "adverb"
  if (w.endsWith("ing") || w.endsWith("ed")) return "verb"
  return ""
}

/**
 * 词性配色。
 * 判断顺序有语义：动词的分支在名词之前，`modal verb` 又必须在 `verb` 之前，
 * 否则情态动词会先命中 `includes('verb')` 变成珊瑚红。
 */
export function posColor(pos: string | null | undefined): string {
  if (!pos) return "#94a3b8"
  const p = normalizePos(pos).toLowerCase()
  if (p.includes("modal") || p.includes("情态")) return "#fb923c"
  if (p.includes("verb") || p.includes("动词") || p.includes("infinitive") || p.includes("不定式"))
    return "#f43f5e"
  if (p.includes("pronoun") || p.includes("代词")) return "#0ea5e9"
  if (p.includes("noun") || p.includes("名词")) return "#3b82f6"
  if (p.includes("adverb") || p.includes("副词")) return "#8b5cf6"
  if (p.includes("adjective") || p.includes("形容词")) return "#f59e0b"
  if (p.includes("conjunction") || p.includes("连词")) return "#06b6d4"
  if (p.includes("preposition") || p.includes("介词")) return "#ec4899"
  if (
    p.includes("article") ||
    p.includes("determiner") ||
    p.includes("冠词") ||
    p.includes("限定词")
  )
    return "#64748b"
  if (p.includes("person") || p === "name" || p.includes("人名")) return "#a855f7"
  return "#94a3b8"
}

/** 颜色兜底序列，词性缺失时按词序取色。 */
const MODERN_COLOR_PALETTE = [
  "#3b82f6",
  "#10b981",
  "#f59e0b",
  "#06b6d4",
  "#6366f1",
  "#ef4444",
  "#14b8a6",
]

/** hex → rgba。非法输入回退蓝色。 */
export function hexToRgba(hex: string | null | undefined, alpha = 1): string {
  if (!hex) return `rgba(59, 130, 246, ${alpha})`
  if (hex.startsWith("rgb")) {
    const m = hex.match(/rgba?\(([^)]+)\)/i)
    if (m) {
      const parts = m[1].split(",").map((p) => parseFloat(p.trim()))
      const [r = 59, g = 130, b = 246] = parts
      return `rgba(${r}, ${g}, ${b}, ${alpha})`
    }
  }
  let n = hex.replace("#", "").trim()
  if (n.length === 3) n = n.split("").map((c) => c + c).join("")
  const num = parseInt(n, 16)
  if (Number.isNaN(num)) return `rgba(59, 130, 246, ${alpha})`
  return `rgba(${(num >> 16) & 255}, ${(num >> 8) & 255}, ${num & 255}, ${alpha})`
}

// ─── 音标 ────────────────────────────────────────────────────────────────────

/** 从 `Word.phonetic` 取指定口音的音标（`_extractPhonetic`）。 */
export function extractPhonetic(
  phonetic: Word["phonetic"] | undefined | null,
  accent: Accent = "us",
): string {
  if (!phonetic) return ""
  // 旧格式是纯字符串（`src/lib/db/schema.ts` 明确禁止窄化成 string，
  // 线上有 7.5 万行是这种历史写法），直接当音标用。
  if (typeof phonetic === "string") return phonetic
  const primary = accent === "uk" ? phonetic.uk : phonetic.us
  const fallback = accent === "uk" ? phonetic.us : phonetic.uk
  return primary || fallback || ""
}

// ─── 可点击单词 ──────────────────────────────────────────────────────────────

/** 缩写 → 原形。 */
const CONTRACTION_MAP: Record<string, string> = {
  "don't": "do",
  "doesn't": "do",
  "didn't": "do",
  "can't": "can",
  "couldn't": "can",
  "won't": "will",
  "wouldn't": "will",
  "isn't": "be",
  "aren't": "be",
  "wasn't": "be",
  "weren't": "be",
  "haven't": "have",
  "hasn't": "have",
  "hadn't": "have",
  "shouldn't": "should",
  "mustn't": "must",
  "i'm": "be",
  "you're": "be",
  "he's": "be",
  "she's": "be",
  "it's": "it",
  "we're": "be",
  "they're": "be",
  "i've": "have",
  "you've": "have",
  "we've": "have",
  "they've": "have",
  "i'll": "will",
  "you'll": "will",
  "he'll": "will",
  "she'll": "will",
  "we'll": "will",
  "they'll": "will",
  "i'd": "would",
  "you'd": "would",
  "he'd": "would",
  "she'd": "would",
  "we'd": "would",
  "they'd": "would",
  "let's": "let",
  "that's": "that",
  "what's": "what",
  "who's": "who",
  "here's": "here",
  "there's": "there",
}

/** 撇号/连字符变体统一（与 `dictation-tokens.normalizeQuotes` 同一套字符集）。 */
function normalizeApostrophes(s: string): string {
  return s
    .replace(/[\u2018\u2019\u201B\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E\u2033]/g, '"')
}

/** 单词 → 查词用的原形（`makeTextWordsClickable`）。 */
export function wordLookupKey(match: string): string | null {
  const lower = normalizeApostrophes(match).toLowerCase()
 // 单字母不查词，a / i 除外。
  if (lower.length < 2 && lower !== "a" && lower !== "i") return null
  if (CONTRACTION_MAP[lower]) return CONTRACTION_MAP[lower]
  if (lower.endsWith("n't")) return lower.slice(0, -3)
  if (lower.includes("'")) return lower.split("'")[0]
  return lower
}

// ─── 分段 ────────────────────────────────────────────────────────────────────

export interface AnnotationWord {
  key: string
  /** 句子里出现的原始拼写。 */
  text: string
  chinese: string
  /** 中文词性标签（「名词」「限定词」…），可能为空。 */
  posLabel: string
  color: string
  phonetic: string
  /** 缩写后缀（'s / 're 等）渲染时要贴紧前一个词。 */
  contractionSuffix: boolean
  /**
 * 内联样式变量。配色写到 `style` 上而不是 class 上
   * （`styleVars`）—— 词性着色按词动态计算，必须内联。
   */
  styleVars: Record<string, string>
}

export type PlainPiece =
  | { kind: "space"; text: string }
  | { kind: "phonetic"; text: string; query: string | null; phonetic: string }

export type AnnotationSegment =
  | { kind: "plain"; pieces: PlainPiece[] }
  | { kind: "word"; word: AnnotationWord }

export interface Annotation {
  segments: AnnotationSegment[]
  hasPhonetics: boolean
  words: AnnotationWord[]
}

/** 纯文本按单词切开，尽可能挂上音标（`generateAnnotatedSentence` 的 plain 分支）。 */
function plainPieces(
  text: string,
  words: Word[],
  usedPhoneticKeys: Set<number>,
  accent: Accent,
): PlainPiece[] {
  const pieces: PlainPiece[] = []
  // 保留空白：split 带捕获组会把分隔符也留在结果里。
  for (const part of normalizeApostrophes(text).split(/(\s+)/)) {
    if (!part) continue
    if (/^\s+$/.test(part)) {
      pieces.push({ kind: "space", text: part })
      continue
    }
    const query = wordLookupKey(part)
    let phonetic = ""
    if (query) {
      const idx = words.findIndex(
        (w, i) =>
          !usedPhoneticKeys.has(i) &&
          normalizeApostrophes(w.english ?? "").toLowerCase().replace(/[.,!?;:"()—\-]/g, "") ===
            query,
      )
      if (idx >= 0) {
        const p = extractPhonetic(words[idx].phonetic, accent)
        if (p) {
          usedPhoneticKeys.add(idx)
          phonetic = p
        }
      }
    }
    pieces.push({ kind: "phonetic", text: part, query, phonetic })
  }
  return pieces
}

/**
 * 生成答案回顾屏的句子结构。
 *
 * 以 `words[]` 为骨架在 `english` 上顺序推进 —— `alignWordsWithEnglish` 已经
 * 保证两侧一一对应，所以这里不需要（也不应该）做全局短语搜索：库里 `words`
 * 顺序错乱的句子用搜索反而会把词性和音标戴到别的词上。
 */
export function buildAnnotation(
  sentence: Sentence | null | undefined,
  accent: Accent = "us",
): Annotation {
  const english = sentence?.english ?? ""
  const rawWords = sentence?.words ?? []
  // pos === "标点" 是 `alignWordsWithEnglish` 对非字母 token 打的标记，
 // 它们不参与注音/着色，等价于普通文本段。
  const words = rawWords.filter((w) => w.pos !== "标点")
  if (!english) return { segments: [], hasPhonetics: false, words: [] }


  const segments: AnnotationSegment[] = []
  const usedPhoneticKeys = new Set<number>()
  const annotated: AnnotationWord[] = []
  let cursor = 0
  let fallbackIndex = 0

  words.forEach((w, wi) => {
    const target = normalizeApostrophes(w.english ?? "")
    if (!target) return
    // 大小写不敏感地从当前位置找这个词；找不到就跳过（宁缺勿错位）。
    const at = english.toLowerCase().indexOf(target.toLowerCase(), cursor)
    if (at < 0) return

    if (at > cursor) {
      segments.push({
        kind: "plain",
        pieces: plainPieces(english.slice(cursor, at), words, usedPhoneticKeys, accent),
      })
    }

    // 哨兵 `词`（是词但词性未知）要当作「拿不到词性」处理：先试启发式推断，
    // 推断不出就既不给标签也不给词性色，落回调色板取色 ——
 // 即「先启发式、再回退调色板」的兜底顺序。
    const rawPos = (w.pos ?? "").trim()
    const hasRealPos =
      rawPos !== "" && rawPos !== WORD_SENTINEL && rawPos !== PUNCT_SENTINEL
    const heuristic = hasRealPos ? "" : inferPos(target)
    const normalized = normalizePos(hasRealPos ? rawPos : heuristic)
    const color =
      (normalized ? posColor(normalized) : "") ||
      MODERN_COLOR_PALETTE[fallbackIndex++ % MODERN_COLOR_PALETTE.length]
    const phonetic = extractPhonetic(w.phonetic, accent)
    const styleVars: Record<string, string> = {
      "--word-color": color,
      "--word-chip-bg": hexToRgba(color, 0.35),
      "--word-chip-border": hexToRgba(color, 0.55),
      "--word-chip-shadow": hexToRgba(color, 0.45),
      "--word-line-color": hexToRgba(color, 0.55),
      "--word-highlight-bg": hexToRgba(color, 0.55),
    }
    const word: AnnotationWord = {
      key: `${wi}-${target}`,
      text: target,
      chinese: w.chinese ?? "",
      // 标签也要走同一条解析链：真实词性 → 启发式 → 空。
      // 直接用 `posLabel(pos)` 会把哨兵 `词` 原样渲出去。
      posLabel: normalized ? posLabel(normalized) : "",
      color,
      phonetic,
      contractionSuffix: /^['\u2018\u2019]/.test(target.trim()),
      styleVars,
    }
    annotated.push(word)
    segments.push({ kind: "word", word })
    cursor = at + target.length
  })

  if (cursor < english.length) {
    segments.push({
      kind: "plain",
      pieces: plainPieces(english.slice(cursor), words, usedPhoneticKeys, accent),
    })
  }

  return { segments, hasPhonetics: annotated.some((w) => w.phonetic), words: annotated }
}
