import { sql, type SQL, type SQLWrapper } from "drizzle-orm"

/**
 * 「中译英」题干的可用性判定。
 *
 * 语料是从外部整批导入的（线上 46 万条），导入时对源数据里**没有中文释义**的
 * 词条，会把英文词头直接写进 `chinese` 字段。于是题干变成 "I"、答案也是 "I"：
 * 用户看到的是英文，而且题干本身就是答案。
 *
 * 线上实测（typenow.sentences，2026-09-24）：
 *   chinese 与 english 完全相同且不含任何中文   1452 条
 *   chinese 不含任何中文                        1669 条
 *   其中在已发布课程里、用户能直接刷到的        1674 条
 *
 * 这类句子必须挡在练习/复习的数据入口，否则用户既没有中文提示、也不知道要敲什么。
 *
 * 判定刻意克制：`n. 鹦鹉；学舌者…` 这种词典体例、`来吧Robbie，…` 这种夹专有名词的
 * 中文，都算**合法**题干（含中文即可），不在过滤范围（此类 68899 条，本次不动）。
 *
 * 字符区间统一用 U+4E00–U+9FA5：JS 与 MySQL 两侧必须完全一致，否则会出现
 * 「按 SQL 过滤的列表」与「按 JS 判定的代码」结论不同这种最难查的分歧。
 */
const CJK_RE = /[\u4e00-\u9fa5]/
const CJK_SQL_CLASS = "[一-龥]"

/** 字符串里是否含中文。 */
export function hasChinese(value: string | null | undefined): boolean {
  return CJK_RE.test(value ?? "")
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

/**
 * `isUsablePrompt` 的 SQL 等价条件。
 *
 * 列表查询与它旁边的计数查询（总数、待复习徽标）必须用**同一个**条件，
 * 否则会出现「徽标显示有 3 条待复习，点进去列表却是空的」这类不一致。
 */
export function usablePromptSql(chinese: SQLWrapper, english: SQLWrapper): SQL {
  return sql`REGEXP_LIKE(TRIM(${chinese}), ${CJK_SQL_CLASS}) AND TRIM(${chinese}) <> TRIM(${english})`
}
