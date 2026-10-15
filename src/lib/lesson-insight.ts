/**
 * 课节级「学习要点」的纯函数层：核心词汇、核心短语。
 *
 * ── 为什么单独一个文件 ────────────────────────────────────────────────────────
 *
 * 基准实现的课节展开区有四块：核心词汇 / 核心短语 / 语法点 / 句子复杂度，
 * 它们是**课节级 AI 分析**的产物。我们库里 `lessons` 表只有
 * `id / course_id / title / summary / sort_order`，**没有**这四块。
 *
 * 决议（用户 m20512 选定）：先从已有数据**派生**可派生的两块（词汇、短语），
 * 语法点与复杂度留占位，不做假数据。
 *
 * 派生规则必须可测：库里的 `sentences.words[].pos` 是 UD 标签，直接取词频
 * 会把 the / a / is 这类虚词顶到最前面（实测一课节前 3 名是 and / I / to），
 * 而 `dependency_analysis.nodes[].phrase` 里混着 `+`、`=`、整句、以及
 * 带空格标点的脏串（实测样本 `I ’ve got to go .`）。这些规则一旦写错，
 * 用户看到的就是一屏垃圾标签 —— 所以全部收在这个无副作用、可单测的模块里。
 */

/** 词频聚合的一行，由 SQL 的 JSON_TABLE 给出。 */
export interface VocabRow {
  word: string
  pos: string
  /** 该课节内的出现次数 */
  count: number
  /** 该词出现在多少个句子里（词频相同用它排序更稳） */
  docs: number
}

/**
 * 不进「核心词汇」的词性。
 *
 * 判据是「这个词单拎出来对学习者没有信息量」：限定词、代词、助动词、
 * 介词、连词、标点都是语法功能词，它们的用法属于语法点而不是词汇表。
 */
const FUNCTION_POS = new Set([
  "DET", "PRON", "PART", "AUX", "ADP", "CCONJ", "SCONJ",
  "PUNCT", "SYM", "X", "NUM", "INTJ",
  // 与库里的中文标记保持一致（见 lib/pos-labels 的「标点」条目）
  "标点",
])

/**
 * 选取核心词汇。
 *
 * 排序口径「先看出现在几个句子里、再看总频次」：一个词在一句里重复 8 次
 * （歌词、口诀课常见）不如分布在 5 个句子里更能代表这一课的内容。
 * 末尾按字母序兜底，保证**同样输入永远同样输出** —— 否则每次请求刷新
 * 标签顺序都会变，用户会以为内容变了。
 */
export function selectVocab(rows: readonly VocabRow[], limit = 20): VocabRow[] {
  const byWord = new Map<string, VocabRow>()
  for (const r of rows) {
    const word = r.word.trim()
    if (word.length <= 2) continue
    if (FUNCTION_POS.has(r.pos)) continue
    // 纯数字 / 纯符号不是词汇
    if (!/[A-Za-z]/.test(word)) continue
    const key = word.toLowerCase()
    const prev = byWord.get(key)
    if (prev) {
      prev.count += r.count
      prev.docs += r.docs
    } else {
      byWord.set(key, { word, pos: r.pos, count: r.count, docs: r.docs })
    }
  }
  return [...byWord.values()]
    .sort((a, b) =>
      b.docs - a.docs ||
      b.count - a.count ||
      a.word.toLowerCase().localeCompare(b.word.toLowerCase()),
    )
    .slice(0, Math.max(0, limit))
}

/**
 * 短语候选的清洗规则。
 *
 * 基准实现的核心短语是人工/AI 挑的「固定搭配」（favourite toy、next to），
 * 我们只能从依存分析节点里捞。实测三类脏数据必须挡掉：
 *   1. `jelly +` / `bird + house = birdhouse` —— 复合词构词法课节的算式，不是短语
 *   2. `I ’ve got to go .` / `See you next week .` —— 整句被当成一个节点，
 *      而且**标点前带空格**（分词遗留），直接显示很难看
 *   3. 单词（`box`）—— 那是词汇，不是短语
 */
export function isUsablePhrase(raw: string, sentence?: string): boolean {
  const p = raw.trim()
  if (p.length < 3 || p.length > 60) return false
  // 算式 / 构词：`+`、`=`、`→` 都是这类课节的标记
  if (/[+=→]/.test(p)) return false
  // 首字符必须是字母或数字：挡掉引语碎片 `" Oh, " said Pig.`、括号残留
  // `( said Pig.` —— 正常搭配（favourite toy / next to）不会以标点开头
  if (!/^[A-Za-z0-9]/.test(p)) return false
  // 必须真的是「短语」：至少两个词
  if (!/\s/.test(p)) return false
  // 整句（与句子正文一致，忽略末尾标点与空格差异）不是短语
  if (sentence) {
    const norm = (s: string) => s.replace(/\s+/g, " ").replace(/[.,!?;:]+$/, "").trim().toLowerCase()
    if (norm(p) === norm(sentence)) return false
  }
  // 至少要有两个「字母开头的词」，挡掉 `a b`、`1 2` 这类
  const words = p.split(/\s+/).filter((w) => /^[A-Za-z]/.test(w))
  if (words.length < 2) return false
  return true
}

/**
 * 把短语规整成可显示的样子：去掉标点前的空格、收拢多余空白。
 *
 * 分词遗留的空格是这个库的已知形态（`I ’ve` / `week .`），练习页的
 * `alignWordsWithEnglish` 也在做同类修补；展示层同样不能原样吐出来。
 */
export function normalizePhrase(raw: string): string {
  return raw
    .replace(/\s+/g, " ")
    .replace(/\s+([.,!?;:'’])/g, "$1")
    .trim()
}

/**
 * 选取核心短语：清洗 → 去重（忽略大小写）→ 按频次排序 → 截断。
 *
 * 同样以字母序兜底，保证输出稳定。
 */
export function selectPhrases(
  rows: readonly { phrase: string; count: number; sentence?: string }[],
  limit = 8,
): { phrase: string; count: number }[] {
  const byPhrase = new Map<string, { phrase: string; count: number }>()
  for (const r of rows) {
    if (!isUsablePhrase(r.phrase, r.sentence)) continue
    const phrase = normalizePhrase(r.phrase)
    if (!isUsablePhrase(phrase, r.sentence)) continue
    const key = phrase.toLowerCase()
    const prev = byPhrase.get(key)
    if (prev) prev.count += r.count
    else byPhrase.set(key, { phrase, count: r.count })
  }
  return [...byPhrase.values()]
    .sort((a, b) =>
      b.count - a.count || a.phrase.toLowerCase().localeCompare(b.phrase.toLowerCase()),
    )
    .slice(0, Math.max(0, limit))
}

/** 句子文本的规整，与上面两处保持一致口径。 */
function normSentence(s: string): string {
  return s.replace(/\s+/g, " ").replace(/[.,!?;:]+$/, "").trim().toLowerCase()
}

/**
 * 从 `chunks` 里取短语。
 *
 * chunks 只有约 5% 的句子有（实测生产库 460,282 句里 22,768 句），
 * 但它质量比依存节点高得多 —— 它本来就是「意群切分」的结果，
 * 形如 `the single most important factor` / `in our well-being`。
 * 有则优先用之。
 */
export function phrasesFromChunks(
  chunks: readonly { text: string; order: number }[],
  sentence: string,
  limit = 8,
): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  // order 大的是更长的合成意群；取较短的、更接近「搭配」的那些
  const sorted = [...chunks].sort((a, b) => a.order - b.order)
  for (const c of sorted) {
    const p = normalizePhrase(c.text)
    if (!isUsablePhrase(p, sentence)) continue
    const key = p.toLowerCase()
    if (seen.has(key)) continue
    // 整句本身（chunks 的最后一个往往就是整句）已经在 isUsablePhrase 里挡掉了
    seen.add(key)
    out.push(p)
    if (out.length >= limit) break
  }
  return out
}

/** 供上面对齐：把句子归一化后比较，导出给单测用。 */
export { normSentence as normalizeSentenceForCompare }
