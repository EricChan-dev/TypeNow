import { describe, it, expect } from "vitest"
import { normalizeForTyping, isTypingMatch, isTypingPrefix, tokenizeEnglish } from "@/lib/typing-compare"

// 判错修复的回归测试。
//
// 背景：这是中译英打字应用，期望英文**从不显示给用户**，用户必须自己敲出来。
// 但课程语料里混入了大量键盘打不出的排版字符：
//   words[].english 含弯引号/破折号 的可达句子 168 句（don’t、I’m、company’s、well—known）
//   english 含同类字符 的可达句子 1,254 句
// 用户照着正确英文敲 don't，与库里的 don’t 用 === 比较必然判错，且看不出错在哪。
//
// 判据：把「键盘可敲出的等价写法」归一化后接受；但绝不能宽到把真正的
// 拼写差异也放过（don't ≠ dont）。

describe("normalizeForTyping", () => {
  it("弯单引号归一到 ASCII 撇号", () => {
    expect(normalizeForTyping("don\u2019t")).toBe("don't")
    expect(normalizeForTyping("I\u2019m")).toBe("I'm")
    expect(normalizeForTyping("company\u2019s")).toBe("company's")
  })

  it("弯双引号归一到 ASCII 双引号", () => {
    expect(normalizeForTyping("\u201Chello\u201D")).toBe('"hello"')
  })

  it("中文/日文引号与顿号不丢字符", () => {
    // 这些不参与英译，但也不能在归一化时被静默删除
    expect(normalizeForTyping("\u300Cok\u300D")).toContain("ok")
  })

  it("en/em dash、横线、图破折号归一到 ASCII 连字符", () => {
    expect(normalizeForTyping("well\u2014known")).toBe("well-known")
    expect(normalizeForTyping("2010\u20132015")).toBe("2010-2015")
    expect(normalizeForTyping("a\u2012b")).toBe("a-b")
    expect(normalizeForTyping("a\u2015b")).toBe("a-b")
  })

  it("省略号与减号归一", () => {
    expect(normalizeForTyping("wait\u2026")).toBe("wait...")
    expect(normalizeForTyping("\u22125")).toBe("-5")
  })

  it("不间断空格与窄空格归一到普通空格", () => {
    expect(normalizeForTyping("New\u00a0York")).toBe("New York")
    expect(normalizeForTyping("New\u202fYork")).toBe("New York")
  })

  it("多字节空格折叠且去首尾", () => {
    expect(normalizeForTyping("  New\u00a0\u00a0York  ")).toBe("New York")
  })

  it("全角字符归一到 ASCII", () => {
    expect(normalizeForTyping("\uff41\uff42\uff43")).toBe("abc")
    expect(normalizeForTyping("9\uff0e5")).toBe("9.5")
  })

  it("下标、上标等兼容字符归一到普通数字", () => {
    expect(normalizeForTyping("H\u2082O")).toBe("H2O")
    expect(normalizeForTyping("km\u00b2")).toBe("km2")
  })

  it("变音符号剥离（用户敲不出 é/ñ/ü）", () => {
    expect(normalizeForTyping("caf\u00e9")).toBe("cafe")
    expect(normalizeForTyping("D\u00eda")).toBe("Dia")
    expect(normalizeForTyping("Telef\u00f3nica")).toBe("Telefonica")
  })

  it("连字与花体兼容字符归一", () => {
    expect(normalizeForTyping("\ufb01n")).toBe("fin")
  })

  it("已归一化的文本保持不变（幂等）", () => {
    const s = "It's a well-known fact, isn't it?"
    expect(normalizeForTyping(normalizeForTyping(s))).toBe(normalizeForTyping(s))
  })
})

describe("isTypingMatch", () => {
  it("弯引号 vs ASCII 撇号视为正确", () => {
    expect(isTypingMatch("don't", "don\u2019t")).toBe(true)
    expect(isTypingMatch("don\u2019t", "don't")).toBe(true)
  })

  it("em dash vs 连字符视为正确", () => {
    expect(isTypingMatch("well-known", "well\u2014known")).toBe(true)
  })

  it("大小写不敏感（保持既有行为）", () => {
    expect(isTypingMatch("Don'T", "don\u2019t")).toBe(true)
  })

  it("首尾空格容错", () => {
    expect(isTypingMatch("  don't  ", "don\u2019t")).toBe(true)
  })

  it("变音符号与全角容错", () => {
    expect(isTypingMatch("cafe", "caf\u00e9")).toBe(true)
    expect(isTypingMatch("H2O", "H\u2082O")).toBe(true)
  })

  it("不放过真正的拼写差异：撇号是有意义的", () => {
    expect(isTypingMatch("dont", "don't")).toBe(false)
    expect(isTypingMatch("don't", "dont")).toBe(false)
  })

  it("不放过真正的拼写差异：普通错词", () => {
    expect(isTypingMatch("cat", "dog")).toBe(false)
    expect(isTypingMatch("receive", "recieve")).toBe(false)
  })

  it("空输入一律不匹配（防止空串蒙对）", () => {
    expect(isTypingMatch("", "don't")).toBe(false)
    expect(isTypingMatch("   ", "don't")).toBe(false)
  })
})

describe("isTypingPrefix", () => {
  // 复习模式（ReviewClient）在每次按键后用 startsWith 判断「目前打对了吗」。
  // 不归一化时 expected = don’t，用户打到 don' 就会被判成打错并立刻标红。

  it("已输入的 ASCII 撇号是弯撇号答案的正确前缀", () => {
    expect(isTypingPrefix("d", "don\u2019t")).toBe(true)
    expect(isTypingPrefix("don", "don\u2019t")).toBe(true)
    expect(isTypingPrefix("don'", "don\u2019t")).toBe(true)
    expect(isTypingPrefix("don't", "don\u2019t")).toBe(true)
  })

  it("反向也成立：输入本身带弯撇号", () => {
    expect(isTypingPrefix("don\u2019", "don't")).toBe(true)
  })

  it("破折号前缀同样容错", () => {
    expect(isTypingPrefix("well-", "well\u2014known")).toBe(true)
  })

  it("变音符号前缀容错", () => {
    expect(isTypingPrefix("caf", "caf\u00e9")).toBe(true)
    expect(isTypingPrefix("cafe", "caf\u00e9")).toBe(true)
  })

  it("空气输入视为「还没打错」", () => {
    expect(isTypingPrefix("", "don\u2019t")).toBe(true)
  })

  it("打错就立刻为 false", () => {
    expect(isTypingPrefix("dx", "don\u2019t")).toBe(false)
    expect(isTypingPrefix("dont", "don\u2019t")).toBe(false)
  })

  it("输入超出答案长度时为 false", () => {
    expect(isTypingPrefix("don't!", "don\u2019t")).toBe(false)
  })
})

describe("tokenizeEnglish", () => {
  it("弯撇号不再把缩写拆成两个词", () => {
    // 修复前：TOKEN_RE 不含 U+2019，don’t 被拆成 ["don","t"]，
    // 用户被迫分两格输入，且第二格只有一个孤立字母 t
    expect(tokenizeEnglish("don\u2019t")).toEqual(["don't"])
    expect(tokenizeEnglish("I\u2019ll be there")).toEqual(["I'll", "be", "there"])
  })

  it("标点仍然是独立 token（供 pos=标点 的提示显示）", () => {
    expect(tokenizeEnglish("Hello, world!")).toEqual(["Hello", ",", "world", "!"])
  })

  it("em dash 变成可输入的连字符 token", () => {
    expect(tokenizeEnglish("well\u2014known")).toEqual(["well-known"])
  })

  it("数字仍是 token", () => {
    expect(tokenizeEnglish("pay $10")).toEqual(["pay", "10"])
  })
})
