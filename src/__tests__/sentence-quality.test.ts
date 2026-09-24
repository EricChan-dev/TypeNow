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
import {
  hasChinese,
  hasTypeableAnswer,
  isUsablePrompt,
  isUsableSentence,
  typeableAnswerSql,
  usablePromptSql,
  usableSentenceSql,
} from "@/lib/sentence-quality"
import { sentences } from "@/lib/db/schema"

/** 把一句 SQL 渲染成文本，便于断言条件内容。 */
function renderSql(condition: ReturnType<typeof usablePromptSql>): string {
  return new MySqlDialect().sqlToQuery(condition).sql
}

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
    const text = renderSql(usablePromptSql(sentences.chinese, sentences.english))
    expect(text).toContain("`sentences`.`chinese`")
    expect(text).toContain("`sentences`.`english`")
    expect(text).toContain("REGEXP_LIKE")
    expect(text).toContain("<>")
  })
})

/**
 * 答案侧判定。线上真实数据：160 条 english 没有任何字母数字——153 条是空串
 * （集中在「惊讶! 学会这些 625 单词就可以走遍天下」这门单词课），7 条只有标点。
 * 它们的 words 都是空数组，练习页渲染出来一个输入格都没有：
 * Space/Enter 直接 return，该句永远不会 complete，进度也走不到 100%。
 */
describe("hasTypeableAnswer", () => {
  it("含字母或数字才算能打", () => {
    expect(hasTypeableAnswer("greeting")).toBe(true)
    expect(hasTypeableAnswer("What day is today ?")).toBe(true)
    expect(hasTypeableAnswer("20")).toBe(true)
    expect(hasTypeableAnswer("T-shirt")).toBe(true)
    expect(hasTypeableAnswer("don't")).toBe(true)
  })

  it("空串 / 纯标点 / 纯空白 / NULL 都不算能打（线上 160 条）", () => {
    expect(hasTypeableAnswer("")).toBe(false)
    expect(hasTypeableAnswer("   ")).toBe(false)
    expect(hasTypeableAnswer("...")).toBe(false)
    expect(hasTypeableAnswer("？")).toBe(false)
    expect(hasTypeableAnswer("-")).toBe(false)
    expect(hasTypeableAnswer(null)).toBe(false)
    expect(hasTypeableAnswer(undefined)).toBe(false)
  })

  it("纯中文答案也不算能打（中译英要敲的是英文）", () => {
    // 「学普通话」那门课的 english 字段里放的是中文，方向压根不是中译英
    expect(hasTypeableAnswer("冬天来了")).toBe(false)
  })
})

describe("isUsableSentence — 题干与答案都要成立", () => {
  it("题干可用 + 答案可打 → 可用", () => {
    expect(isUsableSentence("问候", "greeting")).toBe(true)
    expect(isUsableSentence("我每天学习英语。", "I study English every day.")).toBe(true)
  })

  it("题干脏 → 不可用（即使答案能打）", () => {
    expect(isUsableSentence("I", "I")).toBe(false)
    expect(isUsableSentence("Harvard University。", "Harvard University")).toBe(false)
  })

  it("答案脏 → 不可用（即使题干有中文）", () => {
    expect(isUsableSentence("地面", "")).toBe(false)
    expect(isUsableSentence("图书馆", "...")).toBe(false)
    expect(isUsableSentence("狗", null)).toBe(false)
  })

  it("字母课 a/a 这类：题干过不了、但答案能打，由接口层按整节课兜底决定", () => {
    expect(isUsableSentence("a", "a")).toBe(false) // 单条判定仍不可用
    expect(hasTypeableAnswer("a")).toBe(true) // 但答案侧是过的，所以兜底能救回来
  })
})

describe("usableSentenceSql / typeableAnswerSql", () => {
  it("组合条件 = 题干条件 AND 答案条件（正则类以参数绑定，不内联）", () => {
    const q = new MySqlDialect().sqlToQuery(
      usableSentenceSql(sentences.chinese, sentences.english),
    )
    expect(q.sql).toContain("REGEXP_LIKE")
    expect(q.sql).toContain("<>")
    expect(q.sql).toContain(" AND ")
    // 答案侧用 COALESCE 兜住 NULL，否则 REGEXP_LIKE(NULL) 得到 NULL 而不是 0
    expect(q.sql).toContain("COALESCE")
    expect(q.params).toEqual(["[一-龥]", "[a-zA-Z0-9]"])
  })

  it("答案侧硬条件单独可用（课程接口兜底时只放宽题干）", () => {
    const q = new MySqlDialect().sqlToQuery(typeableAnswerSql(sentences.english))
    expect(q.sql).toContain("`sentences`.`english`")
    expect(q.sql).toContain("COALESCE")
    expect(q.params).toEqual(["[a-zA-Z0-9]"])
    expect(q.sql).not.toContain("<>") // 不含题干判定
    expect(q.sql).not.toContain("chinese")
  })
})
