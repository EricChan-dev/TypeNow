/**
 * 词典中文释义的清洗（src/app/api/dict/word/route.ts 的 cleanChineseWord）。
 *
 * 直击用户报的那个问题：tomorrow 的释义显示成
 * 「минтян；мир；миргә；明仔日；明仔载」。
 *
 * 根因不是数据源全脏，而是上游把「中文」全塞在 language.code = "zh" 一个桶里，
 * 里面混着**被误标成 zh 的西里尔字母词条**和**闽南语**；原来的实现只按 code 过滤、
 * 按顺序取前 5 条，于是这些垃圾排在真正的普通话（name="Chinese Mandarin"）前面。
 */
import { describe, it, expect } from "vitest"
import { cleanChineseWord } from "@/app/api/dict/word/route"

describe("cleanChineseWord", () => {
  it("保留正常的中文词", () => {
    expect(cleanChineseWord("明天")).toBe("明天")
    expect(cleanChineseWord("明日")).toBe("明日")
    expect(cleanChineseWord(" 明儿 ")).toBe("明儿")
  })

  it("**剔除不含汉字的条目**（这就是 минтян / мир / миргә 被展示出来的原因）", () => {
    expect(cleanChineseWord("минтян")).toBeNull()
    expect(cleanChineseWord("мир")).toBeNull()
    expect(cleanChineseWord("миргә")).toBeNull()
    // 纯拼音同样不该出现在"中文释义"里
    expect(cleanChineseWord("mingtian")).toBeNull()
  })

  it("繁简并存时取简体那一半（上游写作 '明兒 /明儿'）", () => {
    expect(cleanChineseWord("明兒 /明儿")).toBe("明儿")
    expect(cleanChineseWord("隔轉工 /隔转工")).toBe("隔转工")
    expect(cleanChineseWord("聽日 /听日")).toBe("听日")
  })

  it("闽南语等**是汉字但不是普通话**的条目仍会通过这一层（由调用处的普通话优先拦截）", () => {
    // cleanChineseWord 只做"是不是汉字"的判断；"是不是普通话"靠 isMandarin
    // 与 mandarin 分流处理。这里明确这一点，避免以后有人误以为这一层能过滤方言。
    expect(cleanChineseWord("明仔日")).toBe("明仔日")
    expect(cleanChineseWord("明仔载")).toBe("明仔载")
  })

  it("空值不抛错", () => {
    expect(cleanChineseWord("")).toBeNull()
    expect(cleanChineseWord("   ")).toBeNull()
    expect(cleanChineseWord("/")).toBeNull()
  })

  it("斜杠两侧只有一边时原样保留（不能因为分割把词吃掉）", () => {
    expect(cleanChineseWord("明天/")).toBe("明天")
    expect(cleanChineseWord("/明天")).toBe("明天")
  })
})
