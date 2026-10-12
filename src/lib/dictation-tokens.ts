/**
 * 听写模式的分词与判题 —— 逐字复刻参考站（句游英语）的口径。
 *
 * 为什么不复用 `typing-compare.ts`：那个模块服务的是**旧版**练习页，
 * 它的归一化比参考站宽（额外把 en dash `–`、minus `−` 折成 `-`，
 * 把省略号 `…` 折成 `...`）。而参考站的分词在抹标点时**只**抹
 * `[.,!?;:"()—]`（em dash），en dash 是被原样留在词里的。
 * 若拿旧模块判题，「用户敲的」与「期望的」会在一小撮含 en dash 的句子上
 * 出现参考站不会有的宽松通过 —— 用户要的是「一模一样」，
 * 所以这里另起一份，且以 practice.js 的行为为唯一依据。
 *
 * 依据（逐字）：
 *   practice.js:4207-4212 分词；text-utils.js:35-43 normalizeQuotes；
 *   practice.js:6845+ checkAnswer 的比较方式。
 * 纯净模块：无 React、无 DB、无 DOM，可直接单测。
 */

/**
 * 引号/连字符归一 —— 与参考站 text-utils.js:35-43 逐字一致。
 *
 * 注意它**不**处理 en dash（`–`）、minus（`−`）、省略号：参考站的注释
 * 明确写着「不转换 en/em dash 等句间标点」。em dash `—` 会在分词阶段
 * 被当标点抹掉，en dash 则留在词里 —— 这是参考站的既有行为，照抄。
 */
export function normalizeQuotes(text: string): string {
  return text
    .replace(/[\u2018\u2019\u201B\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E\u2033]/g, '"')
    .replace(/[\u2010\u2011\uFE63\uFF0D]/g, "-")
}

/**
 * 把一个句子切成听写槽位。
 *
 * 与参考站 practice.js:4207-4212 逐字对应：
 *   normalizeQuotes(sentence).toLowerCase()
 *     .replace(/[.,!?;:"()—]/g, ' ')
 *     .split(/\s+/).filter(w => w.length > 0)
 *
 * 抹掉标点意味着**用户永远不需要敲标点**；撇号与连字符保留，
 * 意味着 don't / well-known 里的 `'` 和 `-` 必须自己敲出来。
 */
export function dictationTokens(sentence: string): string[] {
  return normalizeQuotes(sentence)
    .toLowerCase()
    .replace(/[.,!?;:"()—]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 0)
}

/**
 * 判题前的输入归一 —— 对应 practice.js 的
 * `normalizeQuotes(input.value.trim().toLowerCase())`。
 */
export function normalizeDictationInput(value: string): string {
  return normalizeQuotes(value.trim().toLowerCase())
}

/**
 * 单词判题：**精确相等**，没有模糊匹配、没有编辑距离。
 *
 * 参考站 rawExpected 也过一遍 normalizeQuotes（因为槽位里显示的是原始大小写
 * 词形，用户敲的会被 lower），所以两侧都要归一后再比。
 */
export function isDictationMatch(userValue: string, expected: string): boolean {
  return normalizeDictationInput(userValue) === normalizeQuotes(expected.toLowerCase())
}

/**
 * 该槽位是否「自动填入且只读」。
 *
 * 目前只有一种数据支撑得起的判定：**含数字的词**（参考站 `/\d/.test(word)`），
 * 比如日期、价格、数量 —— 这些不要求用户听写。
 *
 * 参考站还有一类「人名自动填充」，靠 `wordAnalysis[pos] === 'person_name' | 'name'`，
 * 那是后端 NER 产物。我们的 `words[].pos` 存的是中文词性（如「代词」「名词」），
 * 没有 NER 标注，所以这里**刻意不实现人名判定** —— 与其猜错把要练的词
 * 变成只读，不如老老实实让用户敲。
 */
export function isAutoFilledToken(token: string): boolean {
  return /\d/.test(token)
}

/** 参考站的人名判定口径，保留为常量以免日后接上 NER 时各处写法不一致。 */
export const PROPER_NAME_POS = ["person_name", "name"] as const

/**
 * 参考站用于查 wordAnalysis 的人名键：去标点（含连字符，**不含撇号**）。
 * 目前 PROPER_NAME 数据不存在，此函数是为对齐口径而保留。
 */
export function cleanWordForNameLookup(word: string): string {
  return word
    .trim()
    .toLowerCase()
    .replace(/[.,!?;:"()—\-]/g, "")
}
