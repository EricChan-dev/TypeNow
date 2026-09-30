/**
 * 跟读评语的生成。
 *
 * ── 为什么是规则而不是调 AI ──────────────────────────────────────────────────
 *
 * 规则能给出的信息已经覆盖了 AI 的价值：总分档位、最低分词、短板维度
 * （见 docs/superpowers/specs/2026-09-30-pronunciation-scoring-redesign-design.md §3.4）。
 * AI 真正的增量在**音标级诊断**（"volume 的 /v/ 发成了 /w/"），那需要音素级
 * 数据，是另一个功能。
 *
 * ⚠️ **措辞的边界**：没有音素级数据，所以只能说"读得最不清楚"，
 * 绝不能说"某个音发成了另一个音" —— 那是编造。
 *
 * ── 为什么注入 rand ─────────────────────────────────────────────────────────
 *
 * 纯随机会让单测变成"跑十次看有没有出现"这种脆弱写法。注入 rand 之后，
 * 测试可以固定取第一条或最后一条，断言是确定的。
 */

export interface CommentWord {
  word: string
  score: number | null
}

export interface CommentInput {
  score: number
  /** 三个维度与 EvaluateResult 一致：**可为 null**（有道没给这个字段）。 */
  accuracy: number | null
  fluency: number | null
  integrity: number | null
  words: CommentWord[]
  /** 上一次的评语（同一句的上一条记录）。用于避免连着两次说同一句话。 */
  previousComment?: string | null
}

/** 最低分词要低于这个值才点出来。 */
const LOW_WORD_THRESHOLD = 75
/** 最低分词要比句均分低这么多才点出来，避免"全句都很好却单挑一个词"。 */
const LOW_WORD_GAP = 12
/** 维度低于这个值才算短板。 */
const WEAK_DIMENSION_THRESHOLD = 75
/** 低于这个总分基本是录音问题，不是发音问题。 */
const RECORDING_PROBLEM_SCORE = 30

const OVERALL: Record<"top" | "great" | "good" | "pass" | "weak", readonly string[]> = {
  top: [
    "几乎无可挑剔，这句读得跟示范音一样。",
    "非常出色！发音和节奏都很到位。",
    "满分水准，这个句子你已经拿下了。",
    "近乎完美，听不出明显问题。",
    "这一遍非常干净，保持住。",
    "发音准确、节奏自然，很好。",
  ],
  great: [
    "很棒！整体清晰流畅。",
    "读得不错，个别词还能再打磨一下。",
    "整体很稳，发音清楚。",
    "完成得很好，只有小地方可以更讲究。",
    "流畅自然，继续保持。",
    "很不错，细节上再抠一抠就更好。",
  ],
  good: [
    "不错，意思都读出来了，但还能更清楚些。",
    "基本到位，注意几处容易含糊的地方。",
    "整体可以，节奏或个别音还可以更好。",
    "读对了，但还不够利落。",
    "听懂没问题，打磨一下会更好。",
    "已经上路了，把下面几点改掉会有明显进步。",
  ],
  pass: [
    "还差一口气，先慢下来把每个词读准。",
    "能听出你在读什么，但有几处明显偏了。",
    "别急，先求准再求快。",
    "有些词含糊过去了，逐个抠一下。",
    "还可以，但需要再练两遍。",
    "方向对了，准确度还得提上来。",
  ],
  weak: [
    "这句有点吃力，建议先听两遍示范音再录。",
    "不用急，先把句子读慢一点、读完整。",
    "有几处差得比较多，跟着示范音逐句跟读会更快。",
    "先别追求速度，把音读准是第一位的。",
    "这句还没过关，再听一遍示范音试试。",
    "慢慢来，一个词一个词过。",
  ],
}

const LOW_WORD: readonly string[] = [
  "${word} 这个词可以重点练一下。",
  "其中 ${word} 读得最不清楚。",
  "${word} 的发音再注意一下。",
  "卡在 ${word} 上了，单独读几遍。",
  "${word} 是这句里最弱的一环。",
  "下次重点盯一下 ${word}。",
]

const WEAK: Record<"accuracy" | "fluency" | "integrity", readonly string[]> = {
  accuracy: [
    "准确度偏低，注意每个词的音要发全。",
    "有些音发得不够到位，慢一点会更好。",
    "先把音读准，再考虑速度。",
    "个别词的口型没打开，音就飘了。",
    "准确度是这次的主要短板。",
  ],
  fluency: [
    "流利度偏低，试着连贯一些、少停顿。",
    "中间停顿有点多，可以顺着读下去。",
    "读得有点断，试着把词连起来。",
    "节奏可以再顺一点，不用一个词一个词地蹦。",
  ],
  integrity: [
    "有词没读全，注意别漏读。",
    "句子没读完整，最后几个词也要读出来。",
    "有吞音或漏读，把每个词都交代清楚。",
    "完整度不够，读的时候别跳词。",
  ],
}

const RECORDING_PROBLEM = "可能是没录到声音，或者离麦克风太远 —— 确认一下再试。"
const PERFECT = "满分，示范级表现。"

/** 按位置取一条，输入固定时输出固定。 */
function pick(list: readonly string[], rand: () => number): string {
  const i = Math.min(list.length - 1, Math.max(0, Math.floor(rand() * list.length)))
  return list[i]
}

/**
 * 选一条**与上一句不重复**的。
 *
 * ⚠️ 判重用的是「包含」而不是「相等」：传进来的 `avoid` 是**上一整条评语**
 * （总评 + 最低分词 + 短板维度，见 store 读出的 `comment` 列），而这里遍历的是
 * 池子里的**单条总评**，两者永远不会相等。写成 `candidate !== avoid` 会让这条
 * 规则完全失效 —— 上一句原封不动再来一遍，正是它要防的事。
 * 所以问的是「上一句里是不是已经出现过这条总评」。
 *
 * 先按 rand 取，若重复就顺次往后挪一位 —— 池子至少 2 条时必定能挪开。
 * 这比"重新随机直到不同"更可控（不会有理论上不终止的循环）。
 */
function pickAvoiding(
  list: readonly string[],
  rand: () => number,
  avoid: string | null | undefined,
): string {
  if (list.length === 0) return ""
  const start = Math.min(list.length - 1, Math.max(0, Math.floor(rand() * list.length)))
  for (let k = 0; k < list.length; k++) {
    const candidate = list[(start + k) % list.length]
    if (!avoid || !avoid.includes(candidate)) return candidate
  }
  return list[start]
}

function bandOf(score: number): keyof typeof OVERALL {
  if (score >= 95) return "top"
  if (score >= 85) return "great"
  if (score >= 70) return "good"
  if (score >= 55) return "pass"
  return "weak"
}

/** 找出最低分的词；忽略 score 为 null 的词（"没给分"不等于"读得差"）。 */
function lowestWord(words: CommentWord[]): { word: string; score: number } | null {
  let best: { word: string; score: number } | null = null
  for (const w of words) {
    if (w.score === null || w.word === "") continue
    if (best === null || w.score < best.score) best = { word: w.word, score: w.score }
  }
  return best
}

function scoredValues(words: CommentWord[]): number[] {
  return words.filter((w) => w.score !== null && w.word !== "").map((w) => w.score as number)
}

export function buildComment(input: CommentInput, rand: () => number = Math.random): string {
  const { score, accuracy, fluency, integrity, words, previousComment } = input

  // ── 覆盖规则：命中时直接返回，不再拼其它段 ──────────────────────────────────
  if (score < RECORDING_PROBLEM_SCORE) return RECORDING_PROBLEM
  if (score === 100) return PERFECT

  const parts: string[] = [pickAvoiding(OVERALL[bandOf(score)], rand, previousComment)]

  // ── 最低分词：要真的拖了后腿才点出来 ────────────────────────────────────────
  const low = lowestWord(words)
  const values = scoredValues(words)
  if (low && values.length > 0) {
    const avg = values.reduce((a, b) => a + b, 0) / values.length
    if (low.score < LOW_WORD_THRESHOLD && avg - low.score >= LOW_WORD_GAP) {
      parts.push(pick(LOW_WORD, rand).replace("${word}", low.word))
    }
  }

  // ── 短板维度：准确度/流利度门槛 75，完整度门槛 100 ──────────────────────────
  // ⚠️ 必须先判 null：维度可空（有道没给这个字段），而 JS 里 `null < 75` 为 true，
  //    直接写 `accuracy < WEAK_DIMENSION_THRESHOLD` 会把"没给分"当成"读得差"，
  //    给一个字段缺失的用户生成「流利度偏低…」并落库。null 不算短板，跳过。
  if (accuracy !== null && accuracy < WEAK_DIMENSION_THRESHOLD) parts.push(pick(WEAK.accuracy, rand))
  if (fluency !== null && fluency < WEAK_DIMENSION_THRESHOLD) parts.push(pick(WEAK.fluency, rand))
  if (integrity !== null && integrity < 100) parts.push(pick(WEAK.integrity, rand))

  return parts.join("")
}

/** 只给单测用：池子是这个功能里唯一靠人工维护的东西，重复与漏改只能靠断言发现。 */
export const __COMMENT_POOL_FOR_TEST__ = { overall: OVERALL, lowWord: LOW_WORD, weak: WEAK }
