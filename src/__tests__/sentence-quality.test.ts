/**
 * 「中译英」题干可用性判定（src/lib/sentence-quality.ts）。
 *
 * 守的是线上真实数据问题：导入语料时，源数据里没有中文释义的词条被写成
 * chinese = 英文词头，于是题干变成 "I"、答案也是 "I"。线上实测 1452 条
 * chinese === english 且不含中文，1669 条 chinese 不含任何中文。
 *
 * 判定必须克制：含中文就放行，`n. 鹦鹉；学舌者…`、`来吧Robbie，…` 都算合法，
 * 否则会误杀 68899 条正常内容。
 */
import { describe, it, expect } from "vitest"
import { MySqlDialect } from "drizzle-orm/mysql-core"
import { hasChinese, isUsablePrompt, usablePromptSql } from "@/lib/sentence-quality"
import { sentences } from "@/lib/db/schema"

describe("hasChinese", () => {
  it("识别中文", () => {
    expect(hasChinese("你好")).toBe(true)
    expect(hasChinese("来吧Robbie，我们赶紧把她送到动物保护所")).toBe(true)
    expect(hasChinese("n. 鹦鹉；学舌者")).toBe(true)
  })

  it("纯英文/数字/符号不算中文", () => {
    expect(hasChinese("I")).toBe(false)
    expect(hasChinese("greeting")).toBe(false)
    expect(hasChinese("20")).toBe(false)
    expect(hasChinese("Harvard University。")).toBe(false)
    expect(hasChinese("")).toBe(false)
    expect(hasChinese(null)).toBe(false)
    expect(hasChinese(undefined)).toBe(false)
  })
})

describe("isUsablePrompt", () => {
  it("题干等于答案 → 不可用（线上 1452 条）", () => {
    expect(isUsablePrompt("I", "I")).toBe(false)
    expect(isUsablePrompt("am", "am")).toBe(false)
  })

  it("题干不含中文 → 不可用（线上 1669 条）", () => {
    expect(isUsablePrompt("Harvard University。", "Harvard University")).toBe(false)
    expect(isUsablePrompt("20", "twenty")).toBe(false)
    expect(isUsablePrompt("S。", "S")).toBe(false)
  })

  it("正常题干 → 可用", () => {
    expect(isUsablePrompt("问候", "greeting")).toBe(true)
    expect(isUsablePrompt("今天是星期几？", "What day is today ?")).toBe(true)
  })

  it("夹专有名词、带词典词性前缀的中文都算可用（刻意不过滤）", () => {
    expect(isUsablePrompt("来吧Robbie，我们赶紧把她送到动物保护所", "come on robbie let's get her")).toBe(true)
    expect(isUsablePrompt("n. 鹦鹉；学舌者，机械模仿别人的人", "parrot")).toBe(true)
    expect(isUsablePrompt("adj.挥霍无度的，挥金如土的(extravagant)", "profligate")).toBe(true)
  })

  it("首尾空白不影响判定", () => {
    expect(isUsablePrompt("  你好  ", "hello")).toBe(true)
    expect(isUsablePrompt("  I  ", "I")).toBe(false)
  })

  it("题干与答案不同但都不含中文，依然要拦（否则题干仍是英文）", () => {
    expect(isUsablePrompt("Tom！", "Tom !")).toBe(false)
  })
})

describe("usablePromptSql", () => {
  it("引用真实列，且是「含中文 且 题干≠答案」两个条件", () => {
    const { sql: text } = new MySqlDialect().sqlToQuery(
      usablePromptSql(sentences.chinese, sentences.english),
    )
    expect(text).toContain("`sentences`.`chinese`")
    expect(text).toContain("`sentences`.`english`")
    expect(text).toContain("REGEXP_LIKE")
    expect(text).toContain("<>")
  })
})
