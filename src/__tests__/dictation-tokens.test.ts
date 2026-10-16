import { describe, it, expect } from "vitest"
import {
  normalizeQuotes,
  dictationTokens,
  normalizeDictationInput,
  isDictationMatch,
  isAutoFilledToken,
  cleanWordForNameLookup,
} from "@/lib/dictation-tokens"

// 听写分词/判题的对齐测试。
//
// 依据是既定的听写判题行为。
// 这些用例的作用是**锁住既定的听写体验**：任何一条挂了，都说明听写判题
// 出现了可见差异（多要求用户敲一个符号，或少判一个错）。

describe("normalizeQuotes", () => {
  it("弯撇号族归一到 ASCII 撇号", () => {
    expect(normalizeQuotes("don\u2019t")).toBe("don't")
    expect(normalizeQuotes("don\u2018t")).toBe("don't")
    expect(normalizeQuotes("don\u201Bt")).toBe("don't")
    expect(normalizeQuotes("don\u2032t")).toBe("don't")
  })

  it("弯双引号族归一到 ASCII 双引号", () => {
    expect(normalizeQuotes("\u201Chello\u201D")).toBe('"hello"')
    expect(normalizeQuotes("\u201Ehello\u2033")).toBe('"hello"')
  })

  it("连字符变体归一，但 en dash / minus / 省略号不动", () => {
    expect(normalizeQuotes("well\u2010known")).toBe("well-known")
    expect(normalizeQuotes("well\u2011known")).toBe("well-known")
    expect(normalizeQuotes("well\uFE63known")).toBe("well-known")
    expect(normalizeQuotes("well\uFF0Dknown")).toBe("well-known")
 // 约定写明「不转换 en/em dash 等句间标点」
    expect(normalizeQuotes("a\u2013b")).toBe("a\u2013b")
    expect(normalizeQuotes("a\u2212b")).toBe("a\u2212b")
    expect(normalizeQuotes("wait\u2026")).toBe("wait\u2026")
  })
})

describe("dictationTokens", () => {
  it("抹掉标点，且小写化", () => {
    expect(dictationTokens("I am writing, to tell you.")).toEqual([
      "i",
      "am",
      "writing",
      "to",
      "tell",
      "you",
    ])
  })

  it("撇号与连字符保留在词内，必须自己敲", () => {
    expect(dictationTokens("I don't like well-known books.")).toEqual([
      "i",
      "don't",
      "like",
      "well-known",
      "books",
    ])
  })

  it("em dash 被当标点抹掉，会把两侧单词分开", () => {
    expect(dictationTokens("He left\u2014and never returned.")).toEqual([
      "he",
      "left",
      "and",
      "never",
      "returned",
    ])
  })

  it("en dash 不是标点，留在词里", () => {
    expect(dictationTokens("pages 10\u201320 are torn")).toEqual([
      "pages",
      "10\u201320",
      "are",
      "torn",
    ])
  })

  it("弯引号句子先归一再切分", () => {
    expect(dictationTokens("\u201CI don\u2019t know,\u201D she said.")).toEqual([
      "i",
      "don't",
      "know",
      "she",
      "said",
    ])
  })

  it("连续空白折叠，空串得到空数组", () => {
    expect(dictationTokens("  hello   world  ")).toEqual(["hello", "world"])
    expect(dictationTokens("")).toEqual([])
    expect(dictationTokens("   ")).toEqual([])
    expect(dictationTokens("...")).toEqual([])
  })
})

describe("isDictationMatch", () => {
  it("大小写无关、两侧空白无关", () => {
    expect(isDictationMatch("Hello", "hello")).toBe(true)
    expect(isDictationMatch("  hello  ", "hello")).toBe(true)
  })

  it("用户敲 ASCII 撇号、库里是弯撇号 —— 判对", () => {
    expect(isDictationMatch("don't", "don\u2019t")).toBe(true)
    expect(isDictationMatch("company's", "company\u2019s")).toBe(true)
  })

  it("真的拼错要判错，不能放宽到放过拼写差异", () => {
    expect(isDictationMatch("dont", "don't")).toBe(false)
    expect(isDictationMatch("helo", "hello")).toBe(false)
    expect(isDictationMatch("wellknown", "well-known")).toBe(false)
  })

  it("空输入一律不匹配（否则空框会被判对）", () => {
    expect(isDictationMatch("", "hello")).toBe(false)
    expect(isDictationMatch("   ", "hello")).toBe(false)
  })

  it("没有编辑距离：一个字符之差就是错", () => {
    expect(isDictationMatch("hellp", "hello")).toBe(false)
    expect(isDictationMatch("helo", "hello")).toBe(false)
  })
})

describe("isAutoFilledToken", () => {
  it("含数字的词自动填入", () => {
    expect(isAutoFilledToken("2024")).toBe(true)
    expect(isAutoFilledToken("10\u201320")).toBe(true)
    expect(isAutoFilledToken("3rd")).toBe(true)
  })

  it("纯字母词（含撇号连字符）不自动填入", () => {
    expect(isAutoFilledToken("hello")).toBe(false)
    expect(isAutoFilledToken("don't")).toBe(false)
    expect(isAutoFilledToken("well-known")).toBe(false)
  })
})

describe("cleanWordForNameLookup", () => {
  it("去标点含连字符，但不含撇号", () => {
    expect(cleanWordForNameLookup("Mary-Jane")).toBe("maryjane")
    expect(cleanWordForNameLookup("O'Brien")).toBe("o'brien")
    expect(cleanWordForNameLookup("  Tom,  ")).toBe("tom")
  })
})
