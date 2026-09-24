import { sql, type SQL, type SQLWrapper } from "drizzle-orm"

/**
 * 「中译英」这条句子能不能拿去练。两件事都要成立：
 *
 *   1. 题干里有中文（`isUsablePrompt`）——否则用户看到的是英文，而且题干本身就是答案。
 *   2. 答案里有能敲的字符（`hasTypeableAnswer`）——否则练习页一个输入格都渲染不出来。
 *
 * 语料是从外部整批导入的（线上 46 万条），两类脏数据都真实存在：
 *
 *   【题干脏】导入时源数据里没有中文释义的词条，会把英文词头直接写进 `chinese`。
 *     线上实测（typenow.sentences，2026-09-24）：
 *       chinese 与 english 完全相同且不含任何中文   1452 条
 *       chinese 不含任何中文                        1669 条
 *       其中在已发布课程里、用户能直接刷到的        1674 条
 *
 *   【答案脏】english 是空串（153 条）或只有标点（7 条），共 160 条，且**全部**在
 *     已发布课程里、`words` 是空数组。这类句子练习页渲染出来是一个只有中文提示、
 *     没有任何输入格的死画面：Space / Enter 都直接 return，该句永远不会变为
 *     complete，进度也永远走不到 100%。所以答案是空的一律不能下发。
 *
 * 判定刻意克制：`n. 鹦鹉；学舌者…` 这种词典体例、`来吧Robbie，…` 这种夹专有名词的
 * 中文，都算**合法**题干（含中文即可），不在过滤范围（此类 68899 条，本次不动）。
 *
 * 字符区间统一用 U+4E00–U+9FA5：JS 与 MySQL 两侧必须完全一致，否则会出现
 * 「按 SQL 过滤的列表」与「按 JS 判定的代码」结论不同这种最难查的分歧。
 */
const CJK_RE = /[\u4e00-\u9fa5]/
const CJK_SQL_CLASS = "[一-龥]"
/** 能敲的字符：字母或数字。撇号/连字符只在词内部有意义，单独出现不算。 */
const TYPEABLE_RE = /[a-zA-Z0-9]/
const TYPEABLE_SQL_CLASS = "[a-zA-Z0-9]"

/** 字符串里是否含中文。 */
export function hasChinese(value: string | null | undefined): boolean {
  return CJK_RE.test(value ?? "")
}

/** 答案里是否至少有一个可输入的字符（字母/数字）。 */
export function hasTypeableAnswer(english: string | null | undefined): boolean {
  return TYPEABLE_RE.test(english ?? "")
}

/** 题干能否用于「看中文打英文」：必须含中文，且不能与答案雷同。 */
export function isUsablePrompt(
  chinese: string | null | undefined,
  english: string | null | undefined,
): boolean {
  const c = (chinese ?? "").trim()
  if (!hasChinese(c)) return false
  return c !== (english ?? "").trim()
}

/** 这条句子能否拿去练：题干可用 **且** 答案可输入。 */
export function isUsableSentence(
  chinese: string | null | undefined,
  english: string | null | undefined,
): boolean {
  return isUsablePrompt(chinese, english) && hasTypeableAnswer(english)
}

/**
 * `isUsablePrompt` 的 SQL 等价条件。
 *
 * 列表查询与它旁边的计数查询（总数、待复习徽标）必须用**同一个**条件，
 * 否则会出现「徽标显示有 3 条待复习，点进去列表却是空的」这类不一致。
 */
export function usablePromptSql(chinese: SQLWrapper, english: SQLWrapper): SQL {
  return sql`REGEXP_LIKE(TRIM(${chinese}), ${CJK_SQL_CLASS}) AND TRIM(${chinese}) <> TRIM(${english})`
}

/**
 * `hasTypeableAnswer` 的 SQL 等价条件。
 *
 * 这是**硬条件**：答案为空的句子不论在什么课时里都不该下发（练习页会渲染成
 * 没有任何输入格的死画面）。课程接口在「整节课都过不了题干判定」时会放宽题干
 * 这一条来兜底，但**绝不**放宽这一条。
 */
export function typeableAnswerSql(english: SQLWrapper): SQL {
  return sql`REGEXP_LIKE(COALESCE(${english}, ''), ${TYPEABLE_SQL_CLASS})`
}

/** `isUsableSentence` 的 SQL 等价条件（题干 + 答案）。 */
export function usableSentenceSql(chinese: SQLWrapper, english: SQLWrapper): SQL {
  return sql`${usablePromptSql(chinese, english)} AND ${typeableAnswerSql(english)}`
}
