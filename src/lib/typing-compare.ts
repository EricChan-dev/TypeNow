/**
 * 打字判定的容错归一化。
 *
 * 这是中译英打字应用：期望英文**从不显示**给用户，用户必须自己敲出来。
 * 只要库里存的写法与键盘能敲出的写法不一致，用户就会必然判错，而且因为
 * 看不到答案，完全不知道自己错在哪。语料里此类排版字符不少：
 *   words[].english 含弯引号/破折号  可达 168 句（don’t、I’m、company’s、well—known）
 *   english         含同类字符      可达 1,254 句
 *
 * 因此判定前把两侧都归一化到「键盘可敲出的等价写法」。
 *
 * 实测要点（不要凭记忆写）：NFKC **不**转换弯引号 ’ “ ”、em/en dash – —、
 * 省略号 …、减号 −。它只覆盖全角字符、上下标、连字、各种多字节空格。
 * 上面这些必须显式映射，且要在 NFKC 之前 —— 例如 U+2017 经 NFKC 会变成
 * 「空格 + 组合字符」，原始信息就没了。
 *
 * 归一化刻意保持保守：只折叠「同一个字符的另一种写法」，不删除撇号、连字符
 * 这类有语义的符号。所以 don't ≠ dont 依然成立。
 */

/** 与 LearnClient / courses API 共用的英文分词正则。 */
export const TOKEN_RE = /[a-zA-Z\d'-]+|[.,!?;:'"()…—]/g

/** 排版字符 → 键盘等价写法。 */
const CHAR_FOLD: Record<string, string> = {
  // 单引号族
  "\u2018": "'", // ‘
  "\u2019": "'", // ’ 主要元凶
  "\u201a": "'", // ‚
  "\u201b": "'", // ‛
  "\u2017": "'", // ‗ 双下划线（语料里 you‗re 这种脏数据）
  "\u2032": "'", // ′
  "\u2035": "'", // ‵
  "\u2039": "'", // ‹
  "\u203a": "'", // ›
  "\u02bc": "'", // ʼ 修饰字母撇号
  // 双引号族
  "\u201c": '"', // “
  "\u201d": '"', // ”
  "\u201e": '"', // „
  "\u201f": '"', // ‟
  "\u2033": '"', // ″
  // 连字符 / 破折号族
  "\u2010": "-", // ‐
  "\u2011": "-", // ‑ 不换行连字符
  "\u2012": "-", // ‒ 图破折号
  "\u2013": "-", // – en dash
  "\u2014": "-", // — em dash
  "\u2015": "-", // ― 水平线
  "\u2043": "-", // ⁃ 连字符项目符号
  "\u2212": "-", // − 减号
  "\ufe58": "-", // ﹘
  "\ufe63": "-", // ﹣
  // 省略号
  "\u2026": "...", // …
  // 多字节空格（NFKC 也会处理，这里提前统一，避免依赖 NFKC 细节）
  "\u00a0": " ", // NBSP
  "\u202f": " ", // 窄不换行空格
  "\u2007": " ", // 数字空格
}

const FOLD_RE = new RegExp(`[${Object.keys(CHAR_FOLD).join("")}]`, "g")

/** 组合用变音符号。只删组合记号，不用 \p{Diacritic}（它还会吃掉 · 这类符号）。 */
const COMBINING_RE = /[\u0300-\u036f\u1ab0-\u1aff\u1dc0-\u1dff\u20d0-\u20f0\ufe20-\ufe2f]/g

/**
 * 归一化到「键盘可敲出的等价写法」。
 * 顺序：显式折叠 → NFKC（全角/上下标/连字）→ 空白折叠 → 剥离变音符号。
 */
export function normalizeForTyping(value: string): string {
  if (!value) return ""
  return value
    .replace(FOLD_RE, (ch) => CHAR_FOLD[ch] ?? ch)
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .normalize("NFD")
    .replace(COMBINING_RE, "")
    .normalize("NFC")
}

/**
 * 判定用户输入与期望答案是否等价。
 * 空输入一律不匹配，避免空串蒙对。
 */
export function isTypingMatch(input: string, expected: string): boolean {
  const a = normalizeForTyping(input).toLowerCase()
  if (!a) return false
  return a === normalizeForTyping(expected).toLowerCase()
}

/**
 * 判定用户「目前打到一半」的输入是否仍是期望答案的前缀。
 * 复习模式每按一个键都会用它决定是否标红，所以两侧必须同样归一化：
 * 期望是 don’t 时，用户打到 don' 不能算错。
 */
export function isTypingPrefix(input: string, expected: string): boolean {
  const a = normalizeForTyping(input).toLowerCase()
  if (!a) return true
  return normalizeForTyping(expected).toLowerCase().startsWith(a)
}

/**
 * 按打字目标的口径切分英文。
 * 必须先归一化再分词：原始 TOKEN_RE 不含 U+2019，don’t 会被切成
 * ["don","t"]，用户被迫分两格输入且第二格是孤立的 t。
 */
export function tokenizeEnglish(text: string): string[] {
  return normalizeForTyping(text).match(TOKEN_RE) ?? []
}
