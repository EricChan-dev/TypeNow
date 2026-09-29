/**
 * 后台「句子管理」全库模糊搜索的查询构造逻辑（纯函数，无数据库依赖）。
 *
 * ── 背景：为什么不能直接 LIKE ────────────────────────────────────────────────
 *
 * `chinese LIKE '%词%'` 是**前导通配符**，B-tree 索引用不上。2026-09-29 在
 * 生产库（461,933 行 / 数据 2.9GB）实测服务端耗时：
 *
 *     带 lesson_id + LIKE          → 0.0027 秒
 *     全库 LIKE '%天气%'           → 3.19 ~ 12.41 秒（缓存冷热差异）
 *
 * 所以全库搜索走全文索引 `ft_sentences_search`（ngram 解析器，见 00031）。
 * 改造后同一个关键词实测 **0.0031 秒**，约 1000 倍。
 *
 * ── 核心约束：ngram 全文索引只对**纯中文**可靠 ──────────────────────────────
 *
 * 这一条不是推测，是在生产库逐词对照 `LIKE` 口径量出来的。中文完全一致：
 *
 *     天气 1176/1176 ✓   学习英语 97/97 ✓   中华人民共和国 4/4 ✓
 *     动物保护 18/18 ✓   与他的朋友 6/6 ✓   来吧 243/243 ✓   第一位的 3/3 ✓
 *
 * 一旦掺入 ASCII，结果就开始错 —— 既**多匹配**（返回根本不含关键词的句子）
 * 也**少匹配**：
 *
 *     James   MATCH 4414 / LIKE   94   ← 多 47 倍；抽样发现命中的句子只含 am/me/es
 *     jame    MATCH 68640 / LIKE   94   ← 多 730 倍
 *     det.    MATCH 44621 / LIKE  217   ← 多 205 倍
 *     与Allen MATCH 1331  / LIKE    0   ← LIKE 一条都没有，MATCH 凭空造出 1331 条
 *     jam     MATCH    0  / LIKE    4   ← 有明显包含关系的却一条都不返回
 *
 * 受控实验（4 行内容已知的表）复现了这一点：`"james"` 带引号短语返回第 1、2、3 行，
 * 而第 2、3 行根本不含 james（只有 `am`/`me`/`es` 这些 bigram）；`"jam"` 返回空，
 * 而第 1、4 行都含 jam。**引号短语对 ASCII 不强制相邻**，对中文则强制。
 *
 * 多匹配是"搜索结果里有无关句子"，少匹配是"明明有的句子搜不到" ——
 * 后者尤其有害：管理员会据此判断"库里没有这句话"并做出错误的内容决策。
 * 所以**宁可拒绝，也不返回不可靠的结果**。
 *
 * ── 因此本模块的契约 ────────────────────────────────────────────────────────
 *
 * `globalSearchable === true` 当且仅当：**纯中文 + 长度 ≥ 2 + 不超上限**。
 *   · 纯英文 / 中英混合 → false，调用方应返回 400，让使用者先选课时
 *     （课时内走 LIKE 精确子串，任何字符都准确，只是范围小）
 *   · 长度 1 → false（ngram_token_size=2，单字必然 0 条）
 */

/** ngram 分词长度。必须与生产库 `ngram_token_size` 一致，改它就要重建索引。 */
export const NGRAM_TOKEN_SIZE = 2

/** 全库搜索的最小长度。短于此长度不可能命中全文索引。 */
export const MIN_TERM_LENGTH = NGRAM_TOKEN_SIZE

/** 关键词长度上限，防止构造病态查询。 */
export const MAX_TERM_LENGTH = 100

export type TermKind = "empty" | "cjk" | "ascii" | "mixed"

export type RejectReason = "empty" | "too_short" | "too_long" | "not_cjk" | "mixed"

export interface TermAnalysis {
  /** 清洗后的关键词 */
  term: string
  /** 按 Unicode 码点计的长度 */
  length: number
  kind: TermKind
  /** 能否用于**不带课时**的全库搜索 */
  globalSearchable: boolean
  reason?: RejectReason
}

/**
 * 清洗关键词。
 *
 * 去掉会**破坏 BOOLEAN MODE 引号短语语法**的字符：
 *   · `"` —— 提前闭合短语
 *   · `\` —— 转义符
 * 其余运算符（`+ - * @ ~ ( )`）在引号短语内按字面处理（实测不报错），保留。
 *
 * 连续空白折叠成单个空格：短语搜索里空格是 token 的一部分。
 */
export function normalizeSearchTerm(raw: string): string {
  return raw.replace(/["\\]/g, "").replace(/\s+/g, " ").trim()
}

/** 是否含 CJK 统一表意文字。 */
export function hasCjk(text: string): boolean {
  return /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/.test(text)
}

/** 是否**全部**是 CJK（允许中间有空格与中文标点）。 */
export function isPureCjk(text: string): boolean {
  if (!text) return false
  // 允许：CJK、空白、中文标点（，。！？；：、「」『』（）《》…—～·）
  return !/[^\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\s，。！？；：、“”‘’（）《》〈〉「」『』【】…—～·]/.test(text)
}

function codePointLength(text: string): number {
  return [...text].length
}

/**
 * 分析关键词，决定能否用于全库搜索。
 *
 * 调用方契约：
 *   · `globalSearchable === false` → 返回 400 + {@link rejectMessage}，
 *     **绝不**去执行全表 LIKE（那是这个功能要消灭的几秒级全表扫）
 *   · `globalSearchable === true`  → 用 {@link toBooleanPhrase} 构造绑定参数
 */
export function analyzeSearchTerm(raw: string): TermAnalysis {
  const term = normalizeSearchTerm(raw)
  const length = codePointLength(term)

  if (length === 0) {
    return { term, length, kind: "empty", globalSearchable: false, reason: "empty" }
  }
  if (length < MIN_TERM_LENGTH) {
    return { term, length, kind: "cjk", globalSearchable: false, reason: "too_short" }
  }
  if (length > MAX_TERM_LENGTH) {
    return { term, length, kind: "cjk", globalSearchable: false, reason: "too_long" }
  }

  const cjk = hasCjk(term)
  const pure = isPureCjk(term)
  const kind: TermKind = pure ? "cjk" : cjk ? "mixed" : "ascii"

  if (kind === "ascii") {
    return { term, length, kind, globalSearchable: false, reason: "not_cjk" }
  }
  if (kind === "mixed") {
    return { term, length, kind, globalSearchable: false, reason: "mixed" }
  }
  return { term, length, kind, globalSearchable: true }
}

/**
 * 构造 `AGAINST(?)` 的绑定值：BOOLEAN MODE 下的**引号短语**。
 *
 * 对中文而言引号是必需的：裸词在 BOOLEAN MODE 下是各 bigram 取或，
 * 搜「天气很好」会匹配到只含「天气」的 1176 条。加引号后实测与
 * `LIKE '%天气很好%'` 的 18 条一致。
 *
 * 必须用**参数绑定**传入，不要拼进 SQL 字符串。
 */
export function toBooleanPhrase(term: string): string {
  return `"${normalizeSearchTerm(term)}"`
}

/** 拒绝时的用户可读说明（接口 `error` 字段用）。 */
export function rejectMessage(a: TermAnalysis): string {
  switch (a.reason) {
    case "empty":
      return "请输入搜索关键词。"
    case "too_short":
      return (
        `全库搜索要求中文至少 ${MIN_TERM_LENGTH} 个字 —— 全文索引的分词长度是 ` +
        `${NGRAM_TOKEN_SIZE}，单字无法命中。如需按单字或英文精确查找，请先选择题库中的课时。`
      )
    case "too_long":
      return `关键词过长（上限 ${MAX_TERM_LENGTH} 个字符），请缩短后重试。`
    case "not_cjk":
      return (
        "全库搜索目前只支持**纯中文**关键词。英文（含中文夹英文）暂不能全库搜 —— " +
        "实测全文索引对英文既会多匹配（返回不含该词的句子）也会少匹配，返回不可靠的结果比拒绝更糟。" +
        "请先选择题库中的课时，课时内是精确匹配，中英文都准确。"
      )
    case "mixed":
      return (
        "关键词里同时有中文和英文，全库搜索暂不支持这种组合（实测会返回不含该关键词的句子）。" +
        "请只用中文关键词，或先选择题库中的课时做精确匹配。"
      )
    default:
      return "关键词不可用于全库搜索，请先选择题库中的课时。"
  }
}
