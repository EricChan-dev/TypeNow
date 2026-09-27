/**
 * 词典展示处理（src/lib/dict-display.ts）。
 *
 * 两块都来自用户实际看到的问题：
 *   · 音标没包斜杠 —— 库里存的 {uk, us} 不带斜杠，渲染出来是一串光秃秃的音标符号
 *   · 悬浮卡把 (英文词性, 英文释义) 平铺 5 条 —— 用户看到的 "pronoun" 就是它，
 *     而且同一词性重复出现，看起来像"一个单词有那么多词性"
 */
import { describe, it, expect } from "vitest"
import { distinctPosLabels, groupSensesByPos, wrapPhonetic } from "@/lib/dict-display"

describe("wrapPhonetic", () => {
  it("不带斜杠的包起来（这是生产库里 {uk,us} 的形态）", () => {
    expect(wrapPhonetic("ˈtəˈmɒrəʊ")).toBe("/ˈtəˈmɒrəʊ/")
    expect(wrapPhonetic("wɒt")).toBe("/wɒt/")
  })

  it("已经有斜杠的原样返回（词典接口返回的那份自带 /…/）", () => {
    expect(wrapPhonetic("/təˈmɒɹəʊ/")).toBe("/təˈmɒɹəʊ/")
  })

  it("**幂等**：包两次不会变成 //x//", () => {
    const once = wrapPhonetic("wɒt")
    expect(wrapPhonetic(once)).toBe(once)
  })

  it("方括号（严式音标）同样不重复包裹", () => {
    expect(wrapPhonetic("[wɒt]")).toBe("[wɒt]")
  })

  it("空值返回空串（调用方据此决定占位）", () => {
    expect(wrapPhonetic("")).toBe("")
    expect(wrapPhonetic("   ")).toBe("")
    expect(wrapPhonetic(null)).toBe("")
    expect(wrapPhonetic(undefined)).toBe("")
  })

  it("前后空格不影响判断", () => {
    expect(wrapPhonetic("  wɒt  ")).toBe("/wɒt/")
  })
})

describe("groupSensesByPos", () => {
  it("按词性分组，每个词性只出现一次", () => {
    const rows = [
      { pos: "adverb", meaning: "On the day after the present day." },
      { pos: "adverb", meaning: "At some point in the future." },
      { pos: "noun", meaning: "The day after the present day." },
    ]
    const groups = groupSensesByPos(rows)
    expect(groups.map((g) => g.pos)).toEqual(["adverb", "noun"])
    // 这正是"看起来有很多词性"的解法：同一词性不再重复成多行
    expect(groups[0].meanings).toHaveLength(2)
  })

  it("词性翻成中文（用户看到的 pronoun 就来自这里）", () => {
    const groups = groupSensesByPos([
      { pos: "pronoun", meaning: "x" },
      { pos: "noun", meaning: "y" },
      { pos: "adjective", meaning: "z" },
      { pos: "adverb", meaning: "w" },
    ])
    expect(groups.map((g) => g.label)).toEqual(["代词", "名词", "形容词", "副词"])
  })

  it("每个词性最多留 maxPerPos 条释义（默认 2）", () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({ pos: "noun", meaning: `m${i}` }))
    expect(groupSensesByPos(rows)[0].meanings).toEqual(["m0", "m1"])
    expect(groupSensesByPos(rows, 3)[0].meanings).toEqual(["m0", "m1", "m2"])
  })

  it("保持首次出现顺序（上游按常用度排，不能重排）", () => {
    const groups = groupSensesByPos([
      { pos: "adverb", meaning: "a" },
      { pos: "noun", meaning: "b" },
      { pos: "adverb", meaning: "c" },
    ])
    expect(groups.map((g) => g.pos)).toEqual(["adverb", "noun"])
  })

  it("同一条释义不重复", () => {
    const groups = groupSensesByPos([
      { pos: "noun", meaning: "same" },
      { pos: "noun", meaning: "same" },
    ])
    expect(groups[0].meanings).toEqual(["same"])
  })

  it("没有词性的条目归到「释义」而不是被丢掉", () => {
    const groups = groupSensesByPos([{ pos: "", meaning: "orphan" }])
    expect(groups).toEqual([{ pos: "", label: "释义", meanings: ["orphan"] }])
  })

  it("空释义被忽略，不产生空组", () => {
    expect(groupSensesByPos([{ pos: "noun", meaning: "  " }])).toEqual([])
    expect(groupSensesByPos([])).toEqual([])
  })

  it("未登记的新词性回落成原文（比显示「未知」更有助于发现问题）", () => {
    const groups = groupSensesByPos([{ pos: "clitic", meaning: "x" }])
    expect(groups[0].label).toBe("clitic")
  })
})

describe("distinctPosLabels", () => {
  it("给出这个单词的全部中文词性（去重、保序）", () => {
    const labels = distinctPosLabels([
      { pos: "noun", meaning: "a" },
      { pos: "noun", meaning: "b" },
      { pos: "verb", meaning: "c" },
    ])
    expect(labels).toEqual(["名词", "动词"])
  })

  it("空输入返回空数组", () => {
    expect(distinctPosLabels([])).toEqual([])
    expect(distinctPosLabels([{ pos: "", meaning: "x" }])).toEqual([])
  })
})
